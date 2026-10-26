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
| Variable | `GIPHY_API_KEY` | Public GIPHY Web API key for GIF search and display |
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

After deploying changes to tool names, descriptions, or input schemas, open WyaIM's settings in ChatGPT and select **Refresh tools**, then start a new conversation. ChatGPT can retain older tool definitions even while calls reach the updated backend. For multiple spaces, confirm that `list_spaces` is available and `get_profile` accepts `spaceId`. Selecting a space in the website dashboard does not select one for MCP calls; ChatGPT must pass the ID returned by `list_spaces`. See [OpenAI's metadata refresh instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata).

Database migrations run before the Worker upload. Keep them backward-compatible: rolling back a Worker does not undo SQL.

The file-appearance release requires additive migration `0013_file_appearance.sql` before its Worker is uploaded. It adds draft and published JSON appearance columns to `space_files`, defaulting existing files to inherited settings without changing content or visibility. Apply it to local D1 before testing the Files app. Production migration and deployment still require explicit approval together.

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

## GIF search (GIPHY)

The editor's `/gif` command opens a compact picker beside the insertion point. It shows trending GIFs, searches as you type, and inserts a result when clicked. The same field accepts a GIPHY/Tenor link; press Enter or click Insert GIF to insert it. GIPHY blocks display the animated image directly, without a player or related GIFs. GIFs default to a 384px width cap; their saved `size` can specify a width in pixels or `full` to fill the content width. Both options preserve the original aspect ratio and shrink to fit smaller screens. Tenor's public search API was [retired on June 30, 2026](https://support.google.com/tenor/answer/10455265?hl=en), so Tenor uses its public iframe embeds.

Create a Web API key in the [GIPHY developer dashboard](https://developers.giphy.com/dashboard/). Set `GIPHY_API_KEY` in ignored `.dev.vars` and restart the dev server. For a future approved release, set the same name as a GitHub Actions **variable** and in ignored `.env.cloudflare.local`; generated Worker configuration carries it to the runtime. This is a browser-public key, deliberately exposed by `/api/gifs/config`. It is required for search and for displaying all GIPHY blocks, including existing blocks and pasted links. Missing configuration or failed lookups show an unavailable state with Retry, never a player fallback. Tenor embeds do not need the key. No migration is needed.

GIPHY beta keys allow 100 API calls/hour, shared by searches, trending results, and saved GIF lookups. The `wya.im` Web app is registered in GIPHY, and its beta key is configured in the ignored local environment files. Production upgrades require application review and a pricing discussion with GIPHY; plan changes and deployment require owner approval. Follow the [current GIPHY integration requirements](https://developers.giphy.com/docs/api/): browser requests go directly to GIPHY; keep result order, provider attribution, and returned media URLs intact. Saved blocks retain the provider and GIF ID. The browser resolves GIPHY IDs with `GiphyFetch.gif` and renders the returned animated image URL in an `<img>`. Shared configuration and the SDK instance are transient; media assets and URLs are not persisted or proxied.

The picker uses the official `@giphy/js-fetch-api` package. `public/giphy/powered-by-giphy.png` is the unmodified `Giphy Attribution Marks/Static Logos/Small/Light Backgrounds/PoweredBy_200px-White_HorizText.png` (200 x 22) from GIPHY's [official attribution archive](https://media.giphy.com/giphy-attribution-marks.zip), linked from its API documentation. Keep this attribution visible alongside search results.

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

The client loads the SDK only on `wya.im` or an active, verified custom domain and respects Do Not Track and Global Privacy Control. Configuration disables persistence, person profiles, autocapture, recordings, surveys, exceptions, performance capture, campaign/referrer storage, and feature-flag requests. The send hook only permits explicit pageviews and item-link clicks, keeping SDK transport/cookieless fields and the canonical public pathname, host, page kind, a hashed stable space identifier, and the clicked item ID. Click events omit labels and destination URLs. Space IDs are hashed because legacy IDs can contain account identifiers. It drops query strings, fragments, referrers, account data, and other SDK enrichment. No identification calls are made. The public pathname still contains the public profile handle.

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

## Discord contact and support

The Support app sends signed-in users' contact messages to `/api/contact`. Configure
`DISCORD_CONTACT_WEBHOOK` as a separate server secret from `DISCORD_FEEDBACK_WEBHOOK`.
Use ignored `.dev.vars` for local development and ignored `.env.cloudflare.local` for release
tooling; keep these files restricted to the owner. A running local Worker may need a restart
after adding a binding. Never put this URL in browser code, public variables or tracked files.
The provided contact webhook has been saved locally; no production secret was installed.

For an approved release, set the matching GitHub Actions secret. Release preflight validates
the Discord destination, and the existing secret-sync step installs it on the Worker through
stdin. Omitting a secret does not delete an already installed secret. Production secret changes
and deployment require explicit approval. No migration is needed for contact delivery.

Contact messages include the authenticated name, email and account ID, owned selected-space
details, plan/hosting mode, language, a generated reference and timestamp. The form and privacy
notice disclose delivery through Discord. Restrict the destination channel to the support team;
this contact channel contains personal data, unlike the general feedback channel. Replies are
sent separately through the support inbox; posting a Discord reply does not email the customer.

Local tests use mocked delivery. `prepare-local-integration.mjs` explicitly blanks both Discord
webhooks, so route/auth tests cannot send messages to a real channel. Do not run a successful
end-to-end delivery against real credentials without an explicitly authorized test message.

## Discord feedback

The dashboard footer opens a feedback form for signed-in users. Configure
`DISCORD_FEEDBACK_WEBHOOK` in ignored `.dev.vars` for local use and in ignored
`.env.cloudflare.local` for release tooling. Store the same value as a GitHub Actions secret
before an approved release; the existing secret-sync step installs it on the Worker.
Never put the webhook URL in public variables, browser code, or tracked files.
Missing configuration returns a friendly unavailable message. No migration is required.
An omitted secret does not remove a previously installed Worker secret; delete it explicitly
when disabling feedback. Deployment and production secret changes require owner approval.

The server accepts 10–1,800 characters, verifies the session and same-origin request, bounds
the request body, and permits 20 deliveries/hour and 100/day per account.
Delivery quota is reserved before sending and released on failure, including when a later
quota check rejects the request. Separate limits of 6 attempts/minute per account and 30
upstream attempts/minute globally remain in force even when delivery fails.
Rate-limit responses include a retry delay; the form translates
the error, shows a countdown, and keeps the draft editable while submission is disabled.
Feedback goes directly to Discord with mentions and link previews disabled; no account
email or user ID is forwarded. Discord failures preserve the browser draft. Delivery uses
`wait=true` and an eight-second timeout, with no automatic retries (an ambiguous timeout may
already have delivered). Messages are not stored in D1; only abuse-limit counters are stored.
Tests mock delivery and never post to the live channel.

## Custom domains (activation requires approval)

The dashboard includes **Custom domain** in Start > Settings at `/dashboard/domains`, with an EN/PT-BR DNS guide and copyable records. The taskbar space switcher identifies the space being edited. Each space can connect one hostname and choose whether its Wya address stays usable or redirects to that hostname. Both addresses work by default. Only a verified domain with active HTTPS and matching DNS can serve traffic or receive redirects.

Before enabling this in production, request explicit approval for migration `0008_space_domains.sql`, the Worker release, the Cloudflare for SaaS setup, and the runtime secret. This implementation does not provision production resources or change customer DNS automatically.

1. Enable Cloudflare for SaaS on the `wya.im` zone. Review its allowance and billing before activation.
2. Set up an originless, proxied DNS record for `domains.wya.im` (Cloudflare's example uses `AAAA 100::`) and select it as the SaaS fallback origin. Route custom-hostname traffic to the existing `wya-im` Worker using the zone's `*/*` Workers route. Review existing routes first: this wildcard also matches the zone's own subdomains; add explicit exceptions for unrelated services. Keep `wya.im` attached and Workers.dev disabled. These routes are managed in Cloudflare, outside CI.
3. Create a runtime API token scoped only to the `wya.im` zone with **SSL and Certificates Write**. Add it as GitHub Actions secret `CUSTOM_DOMAINS_API_TOKEN`. This is separate from the deployment token and needs no DNS-edit permission. Never put it in a public variable or tracked file.
4. Set GitHub Actions variables `CUSTOM_DOMAINS_ZONE_ID` to the zone ID and `CUSTOM_DOMAINS_TARGET` to `domains.wya.im`. Keep the same three values in ignored release configuration. The release preflight requires all three together. The existing secret-sync step installs the token through stdin.
5. After approval, apply the domain migrations before the Worker upload. They are additive; existing spaces keep their current URLs. Follow the queued-maintenance release steps below for migration `0014_domain_maintenance.sql` and its queues. A failed provider check never extends the last successful verification; after 48 hours without success, domain routing and Wya redirects stop until a successful check.
6. Connect a domain from the dashboard, publish the shown records, and use **Check connection**. Wya verifies its own TXT token before registering the hostname with Cloudflare. Cloudflare may then supply additional ownership/certificate records. Keep these records for ongoing verification. Custom hostnames use TXT for initial certificate validation; Cloudflare handles eligible non-wildcard renewals at its edge.
7. Verify HTTPS, both page styles, tabs, short links, pictures, Discord widgets, canonical URLs, keep-both mode, redirect mode, and removal on the real domain. Confirm dashboard/login links return to `wya.im` and private APIs do not run on the customer domain. Check that the canonical Wya profile remains available whenever the custom domain is pending or disconnected.

For root domains such as `lecastro.me`, the customer's DNS provider must support CNAME flattening or ALIAS/ANAME. Otherwise connect a subdomain such as `www.lecastro.me`. This implementation does not provide apex-proxying IPs or automatically connect `www` alongside the root. Customers using Cloudflare DNS should use DNS-only records when pointing at the SaaS target. Email records are unrelated and should remain intact.

The Worker allows only the matched public space, its short links, static assets, pictures and that space's public Discord widget API on a customer hostname. It drops authentication cookies/headers, accepts only GET/HEAD, and rejects unknown or inactive hosts. The language preference is preserved. Public analytics on verified domains use the existing canonical Wya event identity, so counts stay with the same space. Local previews remain excluded.

Removing a domain disables routing first, then deletes its provider registration. A provider failure retains a cleanup record for retry; do not manually delete it from D1 while its Cloudflare registration remains. Account/space deletion is not currently offered; any future deletion flow must clean up provider registrations before deleting spaces. Domain settings are separate from profile history, so restoring a profile revision cannot restore domain ownership or redirects.

Local checks use mocked provider responses and local D1 only. Live DNS, TLS issuance/renewal, and Cloudflare route configuration still require an approved production setup and smoke test. See [Workers as your fallback origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/), [custom hostname API](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/), and [certificate renewal](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/issue-and-validate/renew-certificates/).

### Queued domain maintenance release

This is a separate production release requiring approval for the Worker, migration `0014_domain_maintenance.sql`, two queues and the additional cron. Local implementation does not activate or bill these resources. Existing SaaS DNS routes and runtime certificate permissions stay the same.

1. Review the Workers/Queues plan and usage budget. Queues currently includes 10,000 operations/day on Free; Paid includes one million operations/month and bills additional operations. A normal delivery uses three operations, and retries add reads. Free-plan invocation limits and daily quotas are unsuitable as an unmeasured promise of large-scale capacity. See [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) and [limits](https://developers.cloudflare.com/queues/platform/limits/).
2. Explicitly create `wya-domain-maintenance` and `wya-domain-maintenance-dead` in the deployment account. The deployment credential needs permission to configure these queues/consumers; the runtime Cloudflare for SaaS API token stays restricted to SSL and Certificates Write. Keep automatic resource provisioning disabled. Do not use the runtime certificate token for queue administration.
3. Apply `0014_domain_maintenance.sql` to the production D1 database before uploading the Worker. It backfills registration identities and adds durable due times and delivery leases. It does not remove domain records or change their ownership. Deploy an isolated release containing only the approved domain changes when unrelated working-tree changes are present.
4. The generated production config binds `DOMAIN_MAINTENANCE`, sets consumer batch size three, concurrency two, five retries and a dead-letter queue. It adds `*/5 * * * *` alongside the existing hourly cleanup. The five-minute handler only dispatches jobs; provider/DNS operations occur in the consumer. Missing queue configuration fails visibly instead of silently reverting to a large inline batch.
5. Verify one real domain through its setup/removal lifecycle and inspect `domain-maintenance-dispatch` / `domain-maintenance-consume` logs. Monitor queue backlog age, dead-letter arrivals, `sendFailures`, retry counts and `oldestVerificationAgeMs`. Alert well before the 48-hour verification cutoff (suggested warning at 24 hours). These are exposed signals; external alert rules are not provisioned by this release. Backlog metrics are capped samples, not a complete inventory count.
6. A successful mutation immediately invalidates the current isolate's lookup cache. Other isolates may serve the preceding routing state for at most 15 seconds; actual verification expiry never gets a grace extension. Include this propagation bound in removal and future subscription-expiry tests. Wya redirects read current D1 state directly.

D1 remains the source of pending work. A message lost after enqueue, exhausted into the dead-letter queue or interrupted during processing becomes dispatchable after its lease expires; repeated failures retain their backoff. The dead-letter queue provides diagnostic evidence, not the only copy of a task. Avoid manual replay while newer registration/dispatch identities exist; stale deliveries are intentionally discarded. Tune dispatch/concurrency using measured provider rate limits and backlog ages before claiming support for tens of thousands of domains.

For rollback, keep the additive columns and queues intact, revert the Worker to the prior approved version and restore its hourly domain refresh behavior. Queue backlog/producer triggers must be reviewed together during rollback; do not delete provider registrations or purge a queue as an automatic rollback step.

### Hosted Premium and Stripe (local implementation)

The dashboard now has **Plans & billing**. Hosted Free allows two spaces; Premium allows ten and one custom domain per space. Self-hosting includes all features without a paid space cap. `WYA_HOSTING_MODE` defaults to `self-hosted`; set the trusted deployment variable to `hosted` for the managed service. This is independent of email sign-in (`WYA_AUTH_MODE`). Existing spaces survive expiry, including accounts above the Free cap. Their Wya URLs keep working; paid-domain routing and redirects require current access.

Do not turn on hosted enforcement as an incidental config change. First agree on how existing connected domains transition to Premium. Migrations do not grant existing accounts free Premium, and enforcement would suspend their domains without a grant. The user approved **US$2.99/month and R$9.99/month**, with no annual offer. Read [the cost model](hosted-pricing-costs.md) for the assumptions and early-stage margin risks.

Before requesting a production release:

1. Apply and exercise migrations `0015_hosted_plans.sql` and `0016_stripe_billing.sql` locally after `0014`. The first removes the historical five-space trigger and adds the access projection; the second adds private customer mappings, checkout attempts, account locks and a durable webhook ledger. A rollback to an old Worker needs a deliberate plan-limit strategy because the five-space trigger is no longer present.
2. Create a Stripe sandbox product for account-wide Premium and two fixed monthly recurring prices: USD with `unit_amount=299` and BRL with `unit_amount=999`, both with `interval=month` and `interval_count=1`. The server validates the Stripe objects against the approved amounts, currency and recurrence before checkout. The dashboard displays the approved monthly prices while checkout is unconfigured. Supply `STRIPE_PRICE_USD_MONTHLY` and `STRIPE_PRICE_BRL_MONTHLY` as server variables; supply `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as secrets. Checkout remains unavailable until configured. Never put keys in the browser or tracked files. Do not replace existing Price IDs when there are subscribers without an explicit legacy-price migration; the current entitlement allowlist contains only the configured prices.
3. Configure the Stripe webhook at the canonical origin's `/api/billing/webhook`. Subscribe to the Checkout completion/async-payment events, subscription created/updated/deleted, and invoice paid/payment-failed/action-required/voided/uncollectible events listed in `lib/billing-service.ts`. The API is pinned to `2025-06-30.basil`. Configure the customer portal for invoices, payment method updates and cancellation at period end; restrict any subscription updates to the configured Premium prices. Trials are not included in this implementation.
4. Run sandbox end-to-end checks for both monthly currencies, a paid renewal, failed renewal, duplicate Checkout attempts, lost responses, duplicate/reordered signed events, period-end cancellation and resubscription. Local tests mock Stripe; they do not replace these real sandbox checks. Browser checkout return parameters never grant access. The server verifies signatures before parsing and derives access from canonical subscription state and matching paid invoice periods.
5. Store the same two monthly Price IDs and `WYA_HOSTING_MODE=hosted` as GitHub Actions variables, and the two keys as GitHub Actions secrets. Release preflight refuses partial setup and test keys in a production release. The secret synchronization script sends values through stdin. Secret omission does not remove a previously installed secret. Obtain approval for the Worker, both migrations, runtime configuration and any provider setup changes before applying them to production.

Cancellation at period end retains the previously paid period. Failed renewals do not extend it; no additional grace period is assumed. A suspended domain retains its claim/setup, while background maintenance removes the provider hostname to stop continuing provider costs. Restoring paid access resets routing until ownership/provider checks succeed again.

Webhooks and opening the billing page reconcile with Stripe under the same account lock. There is no periodic billing reconciliation job yet; monitor failed webhook deliveries and replay them through Stripe when needed. Refunds and disputes do not independently cancel a subscription in this release: handle those through an explicit billing operation and verify access afterward. The durable duplicate ledger retains 30 days, with bounded cleanup. Replayed older events still reconcile current state instead of trusting an old event's access status.
