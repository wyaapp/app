# wya.im

A personal link directory with memorable redirects and account-scoped ChatGPT tools.

Read the [architecture](docs/architecture.md) for the stack and authentication boundary, and the [Cloudflare deployment guide](docs/deployment.md) for GitHub Actions and local deployment. The standalone target is prepared for infrastructure deployment; independent sign-in and public domain routing remain separate launch work.

## First release

- One unique, permanent handle per account, with a public profile at `/:handle`.
- Named redirects at `/:handle/:slug`, using noncached HTTP 302 responses so edits take effect immediately.
- GitHub and Instagram username expansion; full destination URLs for other platforms.
- Display name, bio, three themes, link labels, ordering, visibility, and deletion.
- Hidden links are excluded from public profiles and return 404 as redirects.
- Persistent profiles in Cloudflare D1, revision snapshots, and full-profile restore.
- ChatGPT tools at `/mcp`, sharing the same validation and mutation code as the website.

## Run locally

Use Node 22.13 or newer. The Sites portable starter includes local sign-in simulation; this is never included in the production build.

```sh
npm run install:ci
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_dapper_morlocks.sql
npm run dev
```

Use the actual generated migration filename under `drizzle/` instead of `0000_dapper_morlocks.sql`. Apply each migration once, in order. `npm run dev` serves on loopback and simulates a local account when you follow the sign-in link. `npm start` previews the built Worker without the development sign-in shim.

```sh
npm test
npx tsc --noEmit
```

## Account boundary

Sites dispatch authenticates requests and supplies trusted, Site-scoped identity headers. Every private API and MCP operation selects records using that authenticated identity; callers cannot supply an owner ID. Never host this Worker behind an untrusted proxy that allows visitors to inject these headers. Moving to independent hosting requires replacing the identity adapter and implementing authenticated MCP account linking.

Browser writes require a same-origin JSON POST. All writes are validated server-side. Updates require an expected revision, and atomic D1 batches save the prior state and conditionally update the current profile. A stale client receives a conflict rather than overwriting another session. Restore is itself reversible.

Social username entry constructs a destination URL; it does not verify ownership of that social account. Spaces can be renamed. Only the immediately previous username redirects, until someone claims it or the space is renamed again. Previous usernames are available immediately. Profile data is structured independently of rendering, leaving room for generated page layouts and HTML export later.

## ChatGPT integration

The manifest declares `mcp`. Sites provisions the private plugin on publication. Tools are `get_profile`, `create_profile`, `update_profile`, `upsert_link`, `delete_link`, `reorder_links`, and `restore_revision`. Read `get_profile` before edits and pass its version as `expectedVersion`. All updates apply to the current caller's profile. Tools use Sites authentication, not a standalone OAuth implementation.

## Publication and launch

The initial Site is an owner-only preview. Anonymous profiles and redirects are implemented in the application, but the private hosting boundary currently requires sign-in for all routes. Public distribution, plugin availability to other users, and the `wya.im` DNS connection are separate launch steps. The app does not change DNS by itself.

Before a public service launch, add an abuse reporting and moderation workflow, operational rate limits, account deletion/export, and the required service/privacy information. These are outside this initial private preview. There are no analytics, billing, generated HTML layouts, or third-party social ownership verification yet.

The project uses Vinext/React, Cloudflare Workers, D1, and the Sites build/publish helpers. Source files are under `app/`, shared validation and mutations under `lib/`, and schema/migrations under `db/` and `drizzle/`.


Profile pictures are per space: crop/zoom/rotate in the dashboard, then save a browser-optimized 512px image to R2. JPEG/PNG/WebP inputs and uploads are limited to 5 MB. Pictures have no history; replacing/removing deletes the prior object, and content restores keep the current picture. Standalone deployment requires a private `wya-im-pictures` R2 bucket (see `docs/deployment.md`).
