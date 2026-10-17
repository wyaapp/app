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
| Secret | `TURNSTILE_SECRET_KEY` | Production Turnstile widget secret |
| Variable | `TURNSTILE_SITE_KEY` | Public site key for the same widget, restricted to `wya.im` |
| Variable | `CLOUDFLARE_D1_DATABASE_ID` | UUID of the `wya-im` D1 database |
| Repository variable | `CLOUDFLARE_DEPLOY_ENABLED` | `true` to enable deployment |

The pipeline checks all three authentication/verification secrets before migrations, applies committed SQL, syncs secrets to the Worker through stdin, and deploys the build. It never puts secret values in arguments or generated config. Missing runtime secrets keep the standalone private endpoints blocked. Replacing `BETTER_AUTH_SECRET` affects sessions and encrypted signing keys; retain it across deployments.

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

Before release, run `npm test` (includes migration, ownership, competing claims, single previous-username redirects, and cap enforcement) and the standalone integration harness above (real local D1, auth, MCP, availability and redirects). The tests create local-only identities; production account creation is not necessary for rollout verification. Check the existing account’s space list, links, and history read-only after deployment.

`0003_reclaimable_handles.sql` changes username ownership policy: existing older aliases are removed, and the immediately previous username becomes claimable. Its triggers enforce the policy even during the migration/upload interval. Deploy the matching Worker for correct availability checks and wording; older Workers still read the mappings, but report stale reservation semantics. Roll forward after applying it; reverting application code alone does not restore reservations. For local development, apply this migration to the local D1 database as well.


## Picture storage setup

Before deploying the profile-picture release, enable R2 in the same Cloudflare account and create a **private Standard bucket named `wya-im-pictures`**. R2 activation is a separate usage-billed subscription with an included free tier; it must be approved by the account owner. Leave public development URLs and custom domains disabled. No upload API key or new runtime secret is needed: Wrangler binds the bucket as `PICTURES`.

Deployment uses `wrangler deploy --experimental-provision=false`: D1 and R2 resources are created explicitly, not automatically by CI. This avoids Wrangler's provisioning-only R2 bucket lookup with the existing Workers Scripts / D1 deploy token. Cloudflare still validates the named bucket when uploading the Worker. Use the same flag for manual deployments; a missing bucket must be created before deployment.

The generated standalone config includes this R2 binding and an hourly cleanup Cron Trigger (`17 * * * *`). Migration `0004_profile_pictures.sql` adds the nullable picture key and cleanup ledger. Its number leaves `0003` available for the separate username migration already in progress. Apply committed migrations before the new Worker, as CI already does. Sites development also uses a local `PICTURES` R2 binding; local state stays in `.wrangler`.

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build:cloudflare -- --check`. For the real Worker integration test, apply all committed migrations to the local D1, prepare the ignored integration config, run Wrangler locally on 8787, and run `tests/standalone-integration.mjs`. These checks create only local test accounts and exercise real local R2 upload, serving, copying, and deletion.

## Security release setup

Obtain explicit deployment approval before configuring production resources, applying migrations, or pushing to the auto-deploy branch, as required by `AGENTS.md`.

Create a managed Turnstile widget restricted to `wya.im`. Put its public site key in `TURNSTILE_SITE_KEY` (GitHub variable and ignored local deployment environment) and its secret in `TURNSTILE_SECRET_KEY` (GitHub secret and ignored local environment). Secret synchronization passes it to the Worker via stdin. No browser receives the secret. Production configuration rejects missing or known testing site keys; secret synchronization rejects testing secrets. Sign-in fails closed when server verification is unconfigured or fails. This release does not automatically create the widget.

The `login` action and exact expected hostname are validated in addition to Turnstile success. Do not allow localhost on the production widget. Unit tests inject a local verification stub; local Worker integration creates disposable identities through an in-memory email sink and does not bypass production verification or send real emails. See [Cloudflare server-side verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

Apply `0005_security_limits.sql` before uploading this Worker. **It permanently removes content revisions older than the newest 50 per space**; include this retention change in release approval and take an appropriate database backup before production migration. Current profiles, pictures, and the latest 50 revisions remain. Expired quota rows and recipient leases are cleaned hourly. Existing pending username migration `0003_reclaimable_handles.sql` is a separate behavior change already present in this working tree; explicitly include or isolate it when selecting a release.

Verify blocked resends preserve usable codes, challenge failures send no email, delivery failure does not return success, oversized requests return 413, and authenticated/OAuth flows still work. Never run destructive traffic tests against production. The deployment is not complete until a real browser sign-in verifies the configured production widget and Resend delivery.

### Local cancellation test caveat

Wrangler can drop the next upstream connection after an oversized request body is cancelled ([Workers SDK #15709](https://github.com/cloudflare/workers-sdk/issues/15709)). The integration harness runs these probes after normal operations and makes a read-only GET between probes so the local proxy can safely recover. It never retries a mutation. Byte-limit/cancellation regression tests also run directly against the request reader. This workaround is confined to local testing; it does not establish behavior in production.

## Game catalog (IGDB)

Game search uses [IGDB](https://api-docs.igdb.com/#getting-started) through the Worker. Create a confidential app in the Twitch developer console (requires a Twitch account with 2FA), then obtain its client ID and secret. IGDB documents free access for non-commercial usage; confirm commercial terms with IGDB before monetizing. No account creation or terms acceptance is automated by this code.

For local development, add `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` to the ignored `.dev.vars` file and restart the dev server. Never use a `VITE_` or `NEXT_PUBLIC_` prefix, paste credentials into chat, or commit them. No database migration is needed.

For a future approved deployment, configure both names as GitHub Actions secrets in the deployment environment (or repository). The existing preflight requires both or neither, and secret synchronization sends them to the Worker through stdin. Builds and existing features work without them; search reports that it is not configured. Omitted values do not remove previously installed Worker secrets: revoke/delete both explicitly when disabling the integration. Do not deploy or push to `main` without owner approval.

Selected titles, covers, and catalog references are saved with the item. Public profiles do not call IGDB; covers load directly from its image CDN with no referrer. IGDB is credited once at the bottom of the dashboard and once below the public profile signature when the selected tab shows catalog games. Tiles, search results, and editor previews do not repeat the credit. Search is authenticated, limited to 20 requests/minute per account and three uncached upstream calls/second across Workers, with a bounded ten-minute per-instance result cache. A provider 429 produces a retry message. These are conservative fixed windows, not a guarantee against every rolling-window upstream throttle.
