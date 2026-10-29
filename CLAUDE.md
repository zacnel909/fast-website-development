# fast-website-development

Template for prototype sites on `*.zachtime.xyz`. Global conventions live in `~/Projects/CLAUDE.md`. This file lists only the deltas.

## Deltas from global conventions

- **Single Vite app, not a monorepo.** Prototypes start with one `index.html` + `src/`. Promote to the workspaces layout only when a project grows a real backend or shared package.
- **Uncommitted deploys are allowed (deliberate).** `npm run deploy` publishes the working tree without a commit or push, for rapid QA. Traceability is kept by labelling the build `<sha>-dirty`. This intentionally overrides the global "only deploy committed code" rule for prototypes.
- **No CI/CD.** Deploys run locally with the user's SSO session (`AWS_PROFILE=magic-of-words` by default). Don't add GitHub Actions, OIDC roles, or repo secrets unless asked. The README's "Adding CI/CD later" section describes the intended path.
- **Single-tenant by design.** No `ClientConfig` or org model. One site per repo.

## Per-project setup

`site.config.json` → `subdomain` is the only required edit after creating a repo from the template. The CDK stack is `site-<subdomain>` in us-east-1, in whichever account the `magic-of-words` profile points at.

**Don't commit AWS identifiers** (account ID, hosted zone ID, cert ARN). The repo is public. `scripts/deploy.sh` resolves them from the session and passes them to CDK as env vars, so run CDK through `npm run infra` / `npm run infra:diff`, never `npx cdk` directly.

## Deploy

- `npm run deploy` runs build → s3 sync → invalidation (~15s). It creates the stack on first run.
- `npm run infra` deploys the CDK stack only (after `infra/app.ts` edits).
- Verify a deploy: the page footer and console show `web v<version>`. Check it on the live URL.
