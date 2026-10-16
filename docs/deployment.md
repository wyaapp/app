# Deploy to Cloudflare

The `.github/workflows/cloudflare.yml` workflow tests, typechecks, builds the Sites and standalone targets, and validates a Worker upload on pull requests and pushes. Deployment runs on `main` after checks pass, when `CLOUDFLARE_DEPLOY_ENABLED=true`.

## Configuration

Configure these in `wyaapp/app` repository settings or the `cloudflare-production` environment. The enable switch must be a repository variable.

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Account-scoped Workers Scripts Edit and D1 Edit token |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account ID |
| Secret | `BETTER_AUTH_SECRET` | Stable random value of at least 32 characters |
| Secret | `RESEND_API_KEY` | Resend sending-only key restricted to the verified `wya.im` domain |
| Variable | `CLOUDFLARE_D1_DATABASE_ID` | UUID of the `wya-im` D1 database |
| Repository variable | `CLOUDFLARE_DEPLOY_ENABLED` | `true` to enable deployment |

The pipeline checks both authentication secrets before migrations, applies committed SQL, syncs secrets to the Worker through stdin, and deploys the build. It never puts secret values in arguments or generated config. Missing runtime secrets keep the standalone private endpoints blocked. Replacing `BETTER_AUTH_SECRET` affects sessions and encrypted signing keys; retain it across deployments.

## Resend setup

Use the Free transactional plan. Add `wya.im` as a sending domain, publish the exact supplied DKIM and sending-domain DNS records in Cloudflare DNS, and wait for verification. Receiving mail and catch-all forwarding are not required. Keep open/click tracking disabled for login email.

Create a **Sending access** API key restricted to `wya.im`. Store it as `RESEND_API_KEY` locally, in GitHub Actions, and as a Worker secret. The sender is `wya.im <hello@wya.im>`. After deployment, complete a real sign-in and inspect Resend's delivery status.

## Domain and account boundary

`wya.im` is attached to `wya-im` in the Cloudflare dashboard. Keep this mapping there; CI intentionally has no DNS permission. The generated config has no route assignments and leaves the existing custom-domain attachment untouched. Workers.dev and preview URLs remain disabled. The `global_fetch_strictly_public` compatibility flag lets OAuth verification fetch the Worker’s own public `/api/auth/jwks` endpoint; without it, same-zone fetching can fail and MCP discovery returns HTTP 500.

The Worker strips Sites identity headers. Browser access uses verified email sessions; MCP requires OAuth access tokens. Do not enable an auth bypass or import preview identities as verified email accounts. The Sites database is separate and any profile migration needs a verified owner mapping.

## Local commands

Store production deployment values in ignored `.env.cloudflare.local` with permissions `0600`. Never commit or print it.

```sh
node --env-file=.env.cloudflare.local scripts/build-cloudflare.mjs
node --env-file=.env.cloudflare.local scripts/check-cloudflare-deploy.mjs
node --env-file=.env.cloudflare.local node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --config .cloudflare/wrangler.json
node --env-file=.env.cloudflare.local scripts/sync-auth-secrets.mjs
node --env-file=.env.cloudflare.local node_modules/wrangler/bin/wrangler.js deploy --config dist/server/wrangler.json
```

Build without production credentials with `npm run build:cloudflare -- --check`. Its placeholder D1 ID must never be deployed. For local testing, put a random **local-only** `BETTER_AUTH_SECRET`, a dummy `RESEND_API_KEY`, and `WYA_ORIGIN=http://127.0.0.1:8787` in ignored `.dev.vars`, then prepare the local-only integration configuration after building. The helper removes `global_fetch_strictly_public` only from an ignored copy because localhost signing-key fetches are not public network requests; the production build retains the required flag.

```sh
node scripts/prepare-local-integration.mjs
npx wrangler d1 migrations apply DB --local --config .cloudflare/wrangler.json
npx wrangler dev --config dist/server/wrangler.integration.json --local --persist-to .cloudflare/.wrangler/state --ip 127.0.0.1 --port 8787
# In another terminal:
node --experimental-strip-types tests/standalone-integration.mjs
```

The local integration harness uses an in-memory mail sink and the real auth library to create disposable local identities. It then exercises actual sign-in, sessions, isolation, redirects, OAuth consent, MCP reads and edits, and disconnect in the compiled Worker. It never sends mail or uses production D1. `npm test` covers expiry, code replay, PKCE, OAuth audience, refresh, disconnect, and account isolation with SQLite.

## Connect ChatGPT

Create a custom MCP connection in ChatGPT using `https://wya.im/mcp` with OAuth. Leave client ID/secret blank for dynamic registration. Sign in on `wya.im` using the email code and review the consent page. Test `get_profile`, then a reversible profile edit. Disconnect through `/connections` when needed. Availability of custom connections depends on the ChatGPT account/workspace; this endpoint is not automatically published in the app directory.

Database migrations run before the Worker upload. Keep them backward-compatible: rolling back a Worker does not undo SQL.

References: [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [Better Auth email OTP](https://better-auth.com/docs/plugins/email-otp), [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth), [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction).

## Spaces migration rollout

`0002_spaces.sql` is additive and preserves the original profile and revision tables. Its bridge triggers support writes from the previous Worker until the new deployment takes over. After the new Worker begins editing spaces, **do not roll back to single-profile application code**: legacy writes intentionally fail if the space version has moved ahead. Fix forward with a version that understands the space tables. The old tables are retained for audit/recovery, not current reads.

Before release, run `npm test` (includes migration, ownership, competing renames, reservations, and cap enforcement) and the standalone integration harness above (real local D1, auth, MCP, availability and redirects). The tests create local-only identities; production account creation is not necessary for rollout verification. Check the existing account’s space list, links, and history read-only after deployment.


## Picture storage setup

Before deploying the profile-picture release, enable R2 in the same Cloudflare account and create a **private Standard bucket named `wya-im-pictures`**. R2 activation is a separate usage-billed subscription with an included free tier; it must be approved by the account owner. Leave public development URLs and custom domains disabled. No upload API key or new runtime secret is needed: Wrangler binds the bucket as `PICTURES`.

The generated standalone config includes this R2 binding and an hourly cleanup Cron Trigger (`17 * * * *`). Migration `0004_profile_pictures.sql` adds the nullable picture key and cleanup ledger. Its number leaves `0003` available for the separate username migration already in progress. Apply committed migrations before the new Worker, as CI already does. Sites development also uses a local `PICTURES` R2 binding; local state stays in `.wrangler`.

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build:cloudflare -- --check`. For the real Worker integration test, apply all committed migrations to the local D1, prepare the ignored integration config, run Wrangler locally on 8787, and run `tests/standalone-integration.mjs`. These checks create only local test accounts and exercise real local R2 upload, serving, copying, and deletion.
