# fast-website-development

Template for rapidly prototyping websites on `*.zachtime.xyz` subdomains. Vite + TypeScript, S3 + CloudFront hosting, one-command deploys from your machine.

Live demo: https://fast-website-development.zachtime.xyz

## New project

```bash
gh repo create my-idea --private --clone --template zacnel909/fast-website-development
cd my-idea
# edit site.config.json → "subdomain": "my-idea"   (also rename "name" in package.json)
npm install
npm run deploy
```

The site is now at `https://my-idea.zachtime.xyz`. The first deploy creates the bucket, CloudFront distribution, and DNS record, which takes a few minutes. After that, deploys take about 15 seconds.

Deploy refuses to run while the subdomain is still `fast-website-development` in a repo that isn't the template itself, so a new project can't overwrite the template's site.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server, exposed on your LAN. Open the printed *Network* URL on your phone. |
| `npm run deploy` | Build and publish to `<subdomain>.zachtime.xyz`. Creates the infra stack if it's missing. No commit or push needed. |
| `npm run infra` | Redeploy the CDK stack only. Run this after editing `infra/app.ts`. |
| `npm run infra:diff` | Preview infra changes. |

## Credentials

Deploys use your local AWS session. If no `AWS_PROFILE` or `AWS_ACCESS_KEY_ID` is set, the script uses `AWS_PROFILE=magic-of-words`. When the session expires, run:

```bash
aws sso login --profile magic-of-words
```

Nothing is stored in GitHub and the template doesn't create long-lived keys.

## How it works

- `site.config.json` is the single per-project setting.
- The AWS account, the `zachtime.xyz` hosted zone and the `*.zachtime.xyz` cert are looked up from your session at deploy time, so no account identifiers are committed. Run CDK through the npm scripts rather than `npx cdk` directly.
- `infra/app.ts` is a CDK stack named `site-<subdomain>`. It holds a private S3 bucket (OAC), a CloudFront distribution using the shared `*.zachtime.xyz` wildcard cert, and a Route 53 alias in the `zachtime.xyz` zone. It doesn't upload any files.
- `scripts/deploy.sh` runs `vite build`, then `aws s3 sync`, then a CloudFront invalidation. Hashed `assets/*` are cached forever. Everything else is served `no-cache`, so a refresh always shows the latest deploy.
- The build version is the git short SHA. If the tree is uncommitted the version gets a `-dirty` suffix, and it's `uncommitted` when there's no commit yet. It's shown in the page footer and logged to the console.
- Unknown paths fall back to `index.html`, so client-side routing works.

## Adding dynamic functionality

Keep the same host and add an API behavior to the existing distribution, so there's no CORS and no new domain. In `infra/app.ts`:

```ts
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';

const api = new lambdaNode.NodejsFunction(this, 'Api', {
  entry: 'api/handler.ts',
  runtime: lambda.Runtime.NODEJS_22_X,
  architecture: lambda.Architecture.ARM_64,
  timeout: cdk.Duration.seconds(30),
  memorySize: 256,
});
const apiUrl = api.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

// inside the Distribution props:
additionalBehaviors: {
  '/api/*': {
    origin: new origins.FunctionUrlOrigin(apiUrl),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
  },
},
```

Then run `npm run infra`. Add `esbuild` as a dev dependency so `NodejsFunction` bundles locally instead of in Docker. For data storage, DynamoDB is the default choice. For anything relational, follow the conventions in the global `~/Projects/CLAUDE.md`.

## Adding CI/CD later

`scripts/deploy.sh` doesn't depend on the machine it runs on. It takes credentials from the standard `AWS_*` environment variables. A GitHub Actions job could assume a role through GitHub OIDC (`aws-actions/configure-aws-credentials`, with no stored keys) and then run `npm ci && npm run deploy`. That needs an IAM OIDC provider plus a role scoped to this stack's bucket and distribution. Neither exists yet.
