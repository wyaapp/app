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

`wya.im` is attached to `wya-im` in the Cloudflare dashboard. Keep this mapping there; CI intentionally has no DNS permission. The generated config has no route assignments and leaves the existing custom-domain attachment untouched. Workers.dev and preview URLs remain disabled. The `global_fetch_strictly_public` compatibility flag lets OAuth verification fetch the Worker's own public `/api/auth/jwks` endpoint; without it, same-zone fetching can fail and MCP discovery returns HTTP 500.

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

`0002_spaces.sql` is additive and preserves the original profile and revision tables. Its bridge triggers support writes from the previous Worker until the new deployment takes over. After the new Worker begins editing spaces, **do not roll back to single-profile application code**: legacy writes intentionally fail if the space version has moved ahead. Fix forward with a version that understands the space tables. The old tables are retained for audit/recovery, not current reads, until cleanup migration `0007` is applied.

Before release, run `npm test` (includes migration, ownership, competing claims, single previous-username redirects, and cap enforcement) and the standalone integration harness above (real local D1, auth, MCP, availability and redirects). The tests create local-only identities; production account creation is not necessary for rollout verification. Check the existing account's space list, links, and history read-only after deployment.

`0003_reclaimable_handles.sql` changes username ownership policy: existing older aliases are removed, and the immediately previous username becomes claimable. Its triggers enforce the policy even during the migration/upload interval. Deploy the matching Worker for correct availability checks and wording; older Workers still read the mappings, but report stale reservation semantics. Roll forward after applying it; reverting application code alone does not restore reservations. For local development, apply this migration to the local D1 database as well.


## Retire legacy profile tables

Migration `0007_retire_legacy_profiles.sql` permanently drops `profiles`, `revisions`, and their four bridge triggers. The deployed Worker must already use `spaces` and `space_revisions` (the multiple-spaces release). It does not change authentication tables or reassign Sites identities to email accounts.

Before applying it to production, obtain explicit deployment/migration approval and export a database backup to private, ignored storage. Review the migration against that backup locally. The migration recovers missing `legacy:<user_id>` spaces and missing history within the latest 50 combined revision versions. Existing spaces with newer versions remain authoritative; equal versions must agree on owner, content, and username. Conflicting owners, older space versions, divergent retained history, occupied usernames, or the five-space cap stop the migration rather than silently overwrite data. Wrangler applies the migration atomically; do not run its statements individually in the console or remove its guards to force completion.

After approval and migration, verify the legacy tables and bridge triggers are absent and read existing space lists, public URLs, pictures, and history. Keep the original migration files for fresh installations. Do not deploy pre-spaces application code after cleanup. If a guard fails, keep both sources and reconcile the reported conflict before retrying; production remediation also needs approval.

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

Selected titles, covers, and catalog references are saved with the item. Public profiles do not call IGDB; covers load directly from its image CDN with no referrer. IGDB is credited once at the bottom of the dashboard. Public profiles, tiles, search results, and editor previews do not repeat the credit. Search is authenticated, limited to 20 requests/minute per account and three uncached upstream calls/second across Workers, with a bounded ten-minute per-instance result cache. A provider 429 produces a retry message. These are conservative fixed windows, not a guarantee against every rolling-window upstream throttle.

## Web analytics

Cloudflare Web Analytics is the initial site-wide analytics service. On October 18, 2026, the Cloudflare dashboard showed `wya.im` using **Automatic setup**, with incoming page views and visits. No application beacon, API key, or deployment is needed for this existing setup. Do not add a second beacon to the app while automatic injection is enabled.

Open the Cloudflare account → Observability → Analytics → Web analytics → `wya.im` to see reports, or Manage site to inspect injection settings. See [Cloudflare's setup documentation](https://developers.cloudflare.com/web-analytics/get-started/). These settings live in Cloudflare, not in this repository; local previews do not inherit them. Route exclusions have not been verified.

This provides site-owner traffic and performance reports. The per-space dashboard below uses PostHog; Cloudflare reports are not imported into it. Direct short-link visit counts remain future work.

### PostHog (prepared locally; activation pending)

The app also supports optional PostHog pageviews on the homepage and successfully resolved public profiles. It does not mount analytics on the dashboard, sign-in, OAuth, API, previews, or short-link redirects. Profile tab query changes are not counted as separate pageviews. Cloudflare's existing automatic analytics remain independent and unchanged; the restrictions below apply only to PostHog.

1. Create/select a PostHog project (EU hosting preferred) and enable **Cookieless server hash mode** under Project Settings → Web analytics before activation. See [PostHog's cookieless guide](https://posthog.com/tutorials/cookieless-tracking).
2. Set `POSTHOG_PROJECT_TOKEN` to the public `phc_…` project token and `POSTHOG_HOST` to `https://eu.i.posthog.com` or `https://us.i.posthog.com`, matching the project region. Add both as GitHub Actions variables and, for local release builds, to ignored `.env.cloudflare.local`. A personal API key must never be used here. Both settings are optional, but must be supplied together.
3. For the private Analytics dashboard, set `POSTHOG_PROJECT_ID` (GitHub variable; `310788` for the current EU project). Create a personal API key restricted to this project with only `query:read`. Store it as `POSTHOG_READ_KEY` in ignored local configuration and GitHub Actions secrets. The existing secret-sync step installs it in the Worker during an approved deployment. Never put this `phx_…` key in a public variable or browser code. Local development also needs these settings in ignored `.dev.vars`; localhost does not send tracking events.
4. Obtain deployment approval. No migration is needed. After the approved deployment, visit a public profile and confirm one sanitized `$pageview` and a `wya_item_click` after following an item link in PostHog. Open Analytics as the space owner to verify the live query and counts. Check an authenticated page separately to ensure no new PostHog events occur. Keep usage within the free allowance using PostHog's billing controls; no paid plan or billing change is authorized by this integration.

The client loads the SDK only on `wya.im` and respects Do Not Track and Global Privacy Control. Configuration disables persistence, person profiles, autocapture, recordings, surveys, exceptions, performance capture, campaign/referrer storage, and feature-flag requests. The send hook only permits explicit pageviews and item-link clicks, keeping SDK transport/cookieless fields and the canonical public pathname, host, page kind, a hashed stable space identifier, and the clicked item ID. Click events omit labels and destination URLs. Space IDs are hashed because legacy IDs can contain account identifiers. It drops query strings, fragments, referrers, account data, and other SDK enrichment. No identification calls are made. The public pathname still contains the public profile handle.

Cookieless mode still sends requests to PostHog, which receives network metadata and uses a daily server-side hash for audience measurement. It is not a promise of zero data processing or exact unique-person counts. Missing configuration, blocked scripts, privacy signals, and network failures produce missing analytics rather than blocking the site. Removing both deployment variables disables this integration on the next approved deployment.

The Analytics dashboard reports profile views, link/button clicks, daily UTC totals, and the ten most-clicked items over 7 or 30 days including today. It requires sign-in and space ownership before every cache read. Results are cached per Worker instance for five minutes, bounded to 100 entries, with concurrent requests deduplicated. Shared D1 limits cap upstream queries at 30/minute and 1,000/hour; no new database tables are needed. Missing read credentials show an unconfigured state, not fabricated zero counts. Upstream failures display a retry state.

Counts begin with activation; they are events, not unique visitors. All buttons on an item contribute to that item's count. Renames retain counts through stable IDs; deleted items remain as “Removed item.” Direct short URLs, alias traffic, internal tab switches, non-link game controls, and preview activity are excluded. Owner visits to their public page count. Blocking and untrusted client events mean these figures are directional, not billing-grade. No live PostHog query has been verified yet: project read-key setup and cookieless activation remain pending.

## Legal pages (local drafts)

`/privacy` and `/terms` are linked from sign-in and the homepage footer. They are marked as drafts, with `noindex` metadata and no effective date. The user selected an **18+ account policy** and **contact@wya.im**, and confirmed that the mailbox receives mail. The confirmed operator is **Alex Castro**, acting as an individual. These pages do not implement age verification, acceptance logging, or a self-service account-deletion flow. Sign-in links provide notice without claiming acceptance of finalized terms.

The public pages use plain language. Implementation details belong in `docs/architecture.md`, including session lifetimes, analytics event fields, and scheduled cleanup.

Before publishing the pages:

- Review the legal bases for service delivery, security, legal obligations, and optional processing, along with international transfer arrangements and mandatory local rights. No governing law, exclusive court, arbitration requirement, or liability cap has been selected. An 18+ policy is not a claim that every account holder has been independently age-verified.
- Confirm retention and deletion procedures for account records, logs, provider analytics, backups, and legacy data. Include onboarding answers in account erasure. Code expiry does not guarantee immediate deletion of associated records; only the content revision window and image cleanup currently have concrete retention behavior.
- Finalize the agreement and privacy text, set an effective date, remove the draft notices and draft-only prose, and decide whether signup needs versioned acceptance records. Do not convert the privacy notice into blanket consent.
- Recheck provider disclosures against enabled production services. PostHog activation is still separate from the legal-page work. Its EU region does not mean all Wya data stays in the EU.
- Obtain explicit deployment approval; there are no migrations in this change.

Reference material checked for this draft: [ANPD data-subject rights](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados/direito-dos-titulares), [ANPD contact and complaint guidance](https://www.gov.br/anpd/pt-br/canais_atendimento/cidadao-titular-de-dados/denuncia-peticao-de-titular), [Cloudflare Turnstile privacy](https://www.cloudflare.com/turnstile-privacy-policy/), and [Resend privacy](https://resend.com/legal/privacy-policy). The application code, schema, and deployment notes supplied the service-specific facts; the pages are not a legal compliance certification.
