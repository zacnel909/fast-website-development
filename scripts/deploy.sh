#!/usr/bin/env bash
# Build and publish the site to https://<subdomain>.zachtime.xyz using local AWS credentials.
#
#   npm run deploy           build + upload (~15s). Creates the infra stack first if it doesn't exist.
#   npm run infra            (re)deploy the CDK stack only — run after editing infra/app.ts.
#   npm run infra:diff       preview infra changes.
#
# The AWS account, zachtime.xyz hosted zone and *.zachtime.xyz cert are looked up from the
# current session at run time, so no account identifiers live in the repo.
#
# No commit or push required. Uncommitted builds are labelled <sha>-dirty so the deployed
# version stays traceable.
#
# Credentials: uses whatever the AWS CLI resolves. If nothing is set in the environment,
# defaults to AWS_PROFILE=magic-of-words (SSO). A future CI job can set AWS_* env vars (e.g.
# from GitHub OIDC) and run this same script unchanged.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE=site
[[ "${1:-}" == "--infra" ]] && MODE=infra
[[ "${1:-}" == "--diff" ]] && MODE=diff

if [[ -z "${AWS_PROFILE:-}" && -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  export AWS_PROFILE=magic-of-words
fi
export AWS_REGION=us-east-1

SUBDOMAIN=$(node -p "require('./site.config.json').subdomain")
STACK="site-${SUBDOMAIN}"
TEMPLATE_NAME=fast-website-development

# Guard: a repo created from the template must set its own subdomain, or it would overwrite
# the template's live site.
if [[ "$SUBDOMAIN" == "$TEMPLATE_NAME" ]]; then
  REMOTE=$(git remote get-url origin 2>/dev/null || true)
  if [[ "$REMOTE" != *"/${TEMPLATE_NAME}"* && "$REMOTE" != *"/${TEMPLATE_NAME}.git" ]]; then
    echo "✗ site.config.json still has the template subdomain \"$TEMPLATE_NAME\"." >&2
    echo "  Set \"subdomain\" to this project's name before deploying." >&2
    exit 1
  fi
fi

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "✗ AWS credentials not available${AWS_PROFILE:+ for profile $AWS_PROFILE}." >&2
  echo "  Run: aws sso login --profile ${AWS_PROFILE:-magic-of-words}" >&2
  exit 1
fi

stack_output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

resolve_shared_infra() {
  export CDK_DEFAULT_ACCOUNT CDK_DEFAULT_REGION=us-east-1 SITE_HOSTED_ZONE_ID SITE_CERT_ARN
  CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  SITE_HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name zachtime.xyz \
    --query "HostedZones[?Name=='zachtime.xyz.' && Config.PrivateZone==\`false\`].Id | [0]" --output text)
  SITE_HOSTED_ZONE_ID=${SITE_HOSTED_ZONE_ID#/hostedzone/}
  SITE_CERT_ARN=$(aws acm list-certificates --region us-east-1 --certificate-statuses ISSUED \
    --query "CertificateSummaryList[?DomainName=='*.zachtime.xyz'].CertificateArn | [0]" --output text)
  if [[ "$SITE_HOSTED_ZONE_ID" == None || -z "$SITE_HOSTED_ZONE_ID" || "$SITE_CERT_ARN" == None || -z "$SITE_CERT_ARN" ]]; then
    echo "✗ zachtime.xyz hosted zone or issued *.zachtime.xyz cert not found in account $CDK_DEFAULT_ACCOUNT." >&2
    exit 1
  fi
}

deploy_infra() {
  resolve_shared_infra
  echo "→ Deploying infra stack $STACK (CloudFront creation takes a few minutes the first time)"
  npx cdk deploy "$STACK" --require-approval never
}

if [[ "$MODE" == infra ]]; then
  deploy_infra
  exit 0
fi
if [[ "$MODE" == diff ]]; then
  resolve_shared_infra
  npx cdk diff "$STACK"
  exit 0
fi

if ! aws cloudformation describe-stacks --stack-name "$STACK" >/dev/null 2>&1; then
  deploy_infra
fi

BUCKET=$(stack_output SiteBucketName)
DIST_ID=$(stack_output DistributionId)
URL=$(stack_output SiteUrl)

if git rev-parse --git-dir >/dev/null 2>&1 && git rev-parse HEAD >/dev/null 2>&1; then
  APP_VERSION=$(git rev-parse --short HEAD)
  [[ -n "$(git status --porcelain)" ]] && APP_VERSION="${APP_VERSION}-dirty"
else
  APP_VERSION=uncommitted
fi
export APP_VERSION

echo "→ Building $APP_VERSION"
npm run build --silent

echo "→ Uploading to s3://$BUCKET"
# Hashed assets never change under the same name: cache forever. Old ones are kept so a tab
# still holding a previous index.html doesn't break mid-QA.
if [[ -d dist/assets ]]; then
  aws s3 sync dist/assets "s3://$BUCKET/assets" --only-show-errors \
    --cache-control "public,max-age=31536000,immutable"
fi
# Everything else (index.html, public/ files) revalidates on every load.
aws s3 sync dist "s3://$BUCKET" --only-show-errors --delete --exclude "assets/*" \
  --cache-control "no-cache"

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
  --query 'Invalidation.Id' --output text >/dev/null

echo "✓ Deployed $APP_VERSION → $URL"
