# Browser dashboard and single-column profiles

October 30, 2026. Local implementation and proposed hosting boundary. Nothing in this document implies a production deployment.

## Decision

The private dashboard should be a static browser application at `app.wya.im`. It does not need SEO or server-rendered forms, editors, charts, or navigation. The dashboard and public profiles no longer need the OS presentation, draggable windows, taskbar, desktop icons, or window geometry persistence.

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

Reserve application, API, asset and protocol paths before resolving public handles. The public site must not fall back to the dashboard SPA. Keep existing public links and MCP/OAuth contracts stable; redirect legacy dashboard URLs to the new app only when that app is ready. Serving same-origin APIs on the app host reuses the backend rather than introducing another data store.

This is the target routing split, not a completed hostname or authentication cutover.

## Implemented locally

- The dashboard route authenticates and renders a small loading shell. Its bootstrap fetches `/api/dashboard` in the browser before importing the workspace. The rich editor, charts and settings panels are loaded on demand.
- The private interface is a single document flow with navigation, Files, Bio, page ordering, domains, billing, analytics, history, help, feedback and support.
- Public profiles always use one continuous column of published files. Existing explicit file selections and order are retained; legacy default/main-file preferences remain fallback ordering inputs. Draft content stays private.
- File lists select metadata from D1, without returning draft or published document bodies. Opening a document queries its ID directly. Bootstrap and history authorization omit file bodies.
- Editing a structured block uses a normal dialog, independent of the removed window manager. The existing local draft, save, publish, optimistic version and Trash protections are reused.
- Deleted the OS renderer, window/session manager, app registry, taskbar, Start menu, desktop settings, icon dragging, Paint and Calculator, plus their styles and dedicated tests. Removed the Calculator-only `big.js` packages. Retained files, widgets and the public column now have independent component folders.
- Removed automatic card-form saving and the unused workspace item-edit/delete state. Apply changes only the document draft; Save/Publish are explicit writes.
- Kept stored legacy fields and page-to-file/local-draft recovery for compatibility. Database cleanup is a separate migration; deleting old UI does not delete user content.

**This is not yet a standalone static build at `app.wya.im`.** The current Vinext route still performs authentication and renders the shell. It is an intermediate boundary, with a regression test preventing the workspace from executing during server rendering.

## Static app cutover

1. Create a separate Vite browser entry and static asset output for the dashboard. Replace the remaining Next navigation/locale refresh dependencies in that entry with browser routing and the existing navigation guards. Direct links must return the SPA entry only for application routes; `/api/*` errors must never fall through to HTML.
2. Serve that asset output at `app.wya.im`. Route same-origin `/api/*` and auth endpoints to the existing Worker. Do not use a broad cross-origin API policy or put access tokens in local storage.
3. Give the app secure, HttpOnly, host-only session cookies. Do not widen cookies to `.wya.im`. Add an explicit trusted application host to routing; the current custom-domain router must not mistake `app.wya.im` for a customer hostname.
4. Configure the auth base URL, trusted origins, callback URLs, email links and logout for the app origin. Preserve existing `wya.im/mcp` and OAuth issuer contracts deliberately; these clients must not be broken by a global base-URL replacement. Expect existing dashboard users to sign in on the new host.
5. Redirect old `/dashboard/*` addresses while preserving section and space selection. Public calls to action point to the configured app origin. Keep localhost using a single origin and local authentication.
6. Verify direct navigation, expired sessions, email login, signout, CSRF rejection, ownership, unsaved changes, upload, save/publish, billing return URLs, custom domains and MCP before release. Release DNS, routes, auth settings and redirects together after explicit approval.

## Performance constraints

- No polling for ordinary editing. Load data on screen entry or explicit refresh; refresh only affected resources after successful writes.
- Send changed documents on explicit save/publish. Local typing must not generate network writes. Keep revision conflicts visible instead of overwriting a newer version.
- Keep file bodies out of navigation, plan, space-switcher and list responses. Legacy mutation responses and publication indexing still need a separate cost review; this patch does not claim every backend path is minimal.
- Measure compressed entry/chunk sizes, request CPU and memory, database rows and payload bytes, and public layout stability. A successful local browser run is not evidence that Cloudflare error 1102 is resolved in production.
- Bound public document rendering and cache published output with explicit invalidation on publish/unpublish/delete. Do not cache private API responses publicly.

The static app reduces server rendering work. It does not remove backend work required for durable data, secure authentication, payment processing and external integrations.
