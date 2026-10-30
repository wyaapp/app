# Browser dashboard and single-column profiles

October 30, 2026. Local implementation and hosting boundary. Nothing in this document implies a production deployment.

## Decision

The private dashboard is built as a static browser application at `app.wya.im`. It does not need SEO or server-rendered forms, editors, charts, or navigation. The dashboard and public profiles no longer need the OS presentation, draggable windows, taskbar, desktop icons, or window geometry persistence.

Keep one backend with clear APIs. Moving rendering to the browser does not move authorization or business rules to the browser. A separate frontend hostname does not require a separate backend service or database.

| Surface             | Browser                                                                                    | Server                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Dashboard           | Navigation, forms, local drafts, rich editor, previews, charts; load each screen on demand | Authenticate API requests, check space ownership, enforce limits and versions                              |
| Files               | Request metadata for the list; fetch one document when opened; save and publish explicitly | Validate content, persist drafts, build the published link index, maintain Trash                           |
| Billing and domains | Show status and user actions                                                               | Stripe secrets/webhooks, entitlements, DNS verification, hostname provisioning                             |
| Public profiles     | Small interactive blocks and embedded media as needed                                      | Serve lightweight initial HTML from published content, metadata and redirects; cache safe public responses |

Public HTML is useful server work: readable profiles, search indexing and social previews should not wait for a JavaScript application to fetch everything. This should become a bounded, cacheable read path. Syntax highlighting and editing engines must not enter the request rendering path.

## Host and URL ownership

Confirmed product direction: `wya.im` remains the public website; `app.wya.im` becomes the private management application.

| Address                  | Responsibility                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `wya.im/`                | Existing landing page                                                                  |
| `wya.im/:handle`         | Published space in a single-column layout                                              |
| `wya.im/:handle/:slug`   | Existing space short-link redirects                                                    |
| `wya.im/:handle.png`     | Existing profile-picture endpoint                                                      |
| `app.wya.im`             | Static client-rendered dashboard, login and private management routes                  |
| Connected custom domains | Published space and its short links, using the same public rendering and routing logic |

Reserve application, API, asset and protocol paths before resolving public handles. The public site must not fall back to the dashboard SPA. Public links and MCP/OAuth remain on the public host. There is no compatibility layer for old dashboard URLs or sessions: this is a pre-launch cutover. Serving same-origin APIs on the app host reuses the backend rather than introducing another data store.

This routing split was deployed to production on 2026-10-30. Both hostnames are attached to the existing Worker.

## Implemented

- `dashboard-client/main.tsx` mounts React in a static HTML entry built by `dashboard.vite.config.ts`. It fetches `/api/dashboard` in the browser before importing the workspace. A 401 opens the app login screen. Editors, charts and settings load on demand. The build rejects imports of Next, Vinext, Node and Cloudflare server modules from any dashboard chunk.
- Deleted the Vinext dashboard pages, temporary SSR shell and experimental-dashboard routes. Shared UI uses ordinary anchors and browser locale state; only public server-rendered pages refresh their server locale.
- The Worker checks the configured app host before importing the public renderer. App pages return the static entry through the asset binding; APIs keep their backend handlers. Unknown app paths return 404 and API errors cannot fall through to the SPA. Hashed app assets have immutable cache headers.
- The landing page no longer reads the visitor session. Its calls to action and public profile calls to action link directly to the app. Billing returns and MCP picture-editor links use the app origin.
- App login uses same-origin APIs, secure HttpOnly host-only cookies, and an exact trusted origin. OAuth endpoints remain on `wya.im`; the app auth endpoint exposes only browser login/session/logout operations.
- The private interface is a single document flow with navigation, Files, Bio, page ordering, domains, billing, analytics, history, help, feedback and support.
- Public profiles always use one continuous column of published files. Existing explicit file selections and order are retained; legacy default/main-file preferences remain fallback ordering inputs. Draft content stays private.
- File lists select metadata from D1, without returning draft or published document bodies. Opening a document queries its ID directly. Bootstrap and history authorization omit file bodies.
- Editing a structured block uses a normal dialog, independent of the removed window manager. The existing local draft, save, publish, optimistic version and Trash protections are reused.
- Deleted the OS renderer, window/session manager, app registry, taskbar, Start menu, desktop settings, icon dragging, Paint and Calculator, plus their styles and dedicated tests. Removed the Calculator-only `big.js` packages. Retained files, widgets and the public column now have independent component folders.
- Removed automatic card-form saving and the unused workspace item-edit/delete state. Apply changes only the document draft; Save/Publish are explicit writes.
- Kept stored legacy fields and page-to-file/local-draft recovery for compatibility. Database cleanup is a separate migration; deleting old UI does not delete user content.

## Local development and build

Run `npm run dev` for the existing API/public site on port 5173 and `npm run dev:dashboard` for the static app on port 5174. Open `http://127.0.0.1:5174/`. API and local sign-in requests proxy to 5173, so the browser uses one origin and the existing simulated local account. No production authentication bypass is included in the build.

`npm run build:dashboard` creates `dist/dashboard`. `npm run build:cloudflare -- --check` builds the public/backend Worker, builds the static app, and copies its entry and hashed assets into `dist/client/_app`. The static app is not an RSC route or a second backend. The same Worker serves authenticated APIs on the app host and public content on the public host; static entry dispatch does not run the SSR handler.

## Production cutover

No old dashboard redirects, session transfer, or dual UI rollout is required. Existing saved content is retained; removing UI compatibility is not permission to wipe data.

After local checks, obtain explicit deployment approval covering:

1. Attach `app.wya.im` to the existing `wya-im` Worker alongside `wya.im`. CI intentionally does not manage DNS/custom-domain attachments.
2. Ensure Turnstile allows the app hostname. An existing `wya.im` allowance also covers `app.wya.im`; Cloudflare automatically authorizes subdomains. Keep the public hostname for connector OAuth login.
3. Deploy the built Worker and static assets together. Configuration declares `WYA_APP_ORIGIN=https://app.wya.im`, `WYA_ORIGIN=https://wya.im` and the `ASSETS` binding. The app cookie stays host-only; do not widen it to `.wya.im`.
4. Verify live email-code login/logout, authenticated save/publish, billing returns, public spaces/redirects, custom domains and the public MCP flow. A local mail-sink test cannot verify production email delivery or hostname provisioning.

This cutover adds no database migration. Other pending branch migrations still need their own release review.

### Production verification: 2026-10-30

- User-approved release: Worker version `9fa7e6e6-949e-4282-8742-57f08cdf7de8`, with static assets and `app.wya.im` attachment. No database migrations were pending. Existing production variables were preserved.
- App root, Files route and sign-in return the 754-byte static HTML entry. Hashed entry assets return 200 with immutable one-year caching. The dashboard workspace is not present in the server HTML.
- Unauthenticated dashboard API returns JSON 401; an unknown API returns JSON 404.
- Landing, `/on`, profile picture and `lecastro.me` return 200. `/on/github` redirects to its configured destination.
- Public MCP signing-key lookup succeeds and invalid signatures return 401.
- Live browser checks at 1280px and 390px reach sign-in without application exceptions, missing app chunks or horizontal overflow. The Turnstile challenge renders on the app hostname.
- Production email delivery, authenticated save/publish, logout and billing returns still require a signed-in verification. The automated browser reached the human verification challenge; it did not complete login or change account content.
- Request CPU/memory improvements have not yet been measured. Successful smoke checks are not a load test.

## Performance constraints

- No polling for ordinary editing. Load data on screen entry or explicit refresh; refresh only affected resources after successful writes.
- Send changed documents on explicit save/publish. Local typing must not generate network writes. Keep revision conflicts visible instead of overwriting a newer version.
- Keep file bodies out of navigation, plan, space-switcher and list responses. Legacy mutation responses and publication indexing still need a separate cost review; this patch does not claim every backend path is minimal.
- Measure compressed entry/chunk sizes, request CPU and memory, database rows and payload bytes, and public layout stability. A successful local browser run is not evidence that Cloudflare error 1102 is resolved in production.
- Bound public document rendering and cache published output with explicit invalidation on publish/unpublish/delete. Do not cache private API responses publicly.

The static app reduces server rendering work. It does not remove backend work required for durable data, secure authentication, payment processing and external integrations.
