import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import siteConfig from '../site.config.json' with { type: 'json' };

// Shared zachtime.xyz infra. Account, hosted zone and wildcard cert are resolved from the caller's
// AWS session by scripts/deploy.sh rather than committed, so the repo carries no account identifiers.
const REGION = 'us-east-1';
const DOMAIN = 'zachtime.xyz';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — run CDK through scripts/deploy.sh (npm run infra / infra:diff)`);
  return value;
}
const ACCOUNT = required('CDK_DEFAULT_ACCOUNT');
const HOSTED_ZONE_ID = required('SITE_HOSTED_ZONE_ID');
// Wildcard *.zachtime.xyz cert in us-east-1 (required region for CloudFront).
const CERT_ARN = required('SITE_CERT_ARN');

const subdomain = siteConfig.subdomain;
if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(subdomain)) {
  throw new Error(`site.config.json subdomain "${subdomain}" is not a valid DNS label`);
}
const host = `${subdomain}.${DOMAIN}`;

// Infrastructure only. Site files are uploaded by scripts/deploy.sh (s3 sync + invalidation),
// which is seconds rather than the minute-plus a CDK BucketDeployment costs per change.
class SiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: HOSTED_ZONE_ID,
      zoneName: DOMAIN,
    });
    const certificate = acm.Certificate.fromCertificateArn(this, 'WildcardCert', CERT_ARN);

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      // Dynamic routes go here when a project needs them, e.g. a Lambda Function URL:
      //   additionalBehaviors: { '/api/*': { origin: new origins.FunctionUrlOrigin(fnUrl), ... } }
      // See README "Adding dynamic functionality".
      domainNames: [host],
      certificate,
      defaultRootObject: 'index.html',
      // SPA fallback. The bucket is private behind OAC, so missing keys come back as 403, not
      // 404 — both must map to index.html for client-side routes to load.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(10) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(10) },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: host,
    });

    new route53.ARecord(this, 'SiteARecord', {
      zone,
      recordName: host,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // scripts/deploy.sh reads these by OutputKey.
    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${host}` });
    new cdk.CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
  }
}

const app = new cdk.App();
new SiteStack(app, `site-${subdomain}`, { env: { account: ACCOUNT, region: REGION } });
