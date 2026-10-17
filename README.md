![wya.im — One address. All of you.](docs/assets/hero-options/personal-tiles.png)

# wya.im

**Where you at?** A home for your links, projects, and different sides of you. Build a personal space with memorable short URLs, then manage it from the dashboard or through ChatGPT.

```text
wya.im/alex                 → public profile
wya.im/alex/github          → named short link
wya.im/alex?tab=games       → a tab within the profile
```

This README describes the current source, including changes that may not yet be deployed to `wya.im`.

## Features

- **Multiple spaces:** up to five per account, each with its own username, profile, content, and history. Usernames can be changed and support dots.
- **Links and aliases:** editable display names and URL slugs, social presets, a searchable SVG icon library, email links with optional subject/message, and up to ten aliases pointing to the same item. GitHub and Instagram accept usernames as well as URLs.
- **Project tiles:** showcase work with a title, description, optional hosted HTTPS thumbnail, and one to three action links. New projects start hidden unless explicitly published.
- **Optional tabs:** up to five per space, with custom names, URL names, ordering, and a default tab. A single tab hides the navigation. Tabs share the profile header and existing short URLs.
- **Sections and ordering:** organize items into titled sections, drag items or whole sections, use keyboard/arrow controls, and move content between tabs. Layout changes stay in a draft until **Save layout**; **Discard** restores the saved layout.
- **Deliberate removal:** deleting an item opens a confirmation dialog. Removing a tab requires choosing a destination and confirming; its items and sections move there. Choosing a destination alone changes nothing, and tab removal still waits for **Save layout** to publish.
- **Personalization:** profile pictures, twelve color palettes, display names, and bios with clickable mentions and links.
- **History:** retain the latest fifty content revisions per space and restore earlier content. Pictures and usernames are not rolled back by content restoration.
- **Passwordless sign-in:** email codes delivered by Resend, with Better Auth sessions and Cloudflare Turnstile verification.
- **ChatGPT editing:** authenticated MCP tools use the same validation, ownership checks, and storage as the dashboard.

Each space supports up to 100 links and projects combined, including at most twelve projects, and twenty sections across all its tabs. Save a newly created tab before adding new items to it; existing items can be moved into it while drafting.

Hidden items are omitted from public profiles and their short URLs return 404. HTTP(S) destinations use noncached 302 redirects; email links open a mail composer. Wya profile and homepage destinations are allowed, while internal short-link cycles are rejected.

### Profile pictures

Upload a JPEG, PNG, or WebP up to 5 MB, crop/zoom/rotate in the dashboard, and save a browser-optimized 512×512 image. The Worker enforces the upload byte limit and raster type/signature; it does not resize images. Pictures live in a private R2 bucket and are served through the app.

Pictures have no history. Replacing or removing one deletes the prior object; failed cleanup is retried by scheduled maintenance. Restoring profile content keeps the current picture. Upload new pictures through the dashboard; MCP supports copying a current picture between owned spaces or removing it.

## Architecture

The standalone app runs in one Cloudflare Worker. The dashboard and MCP endpoint share the profile service and database.

| Component | Role |
| --- | --- |
| React, TypeScript, Vinext, Vite | Public profiles, dashboard, and server routes |
| Cloudflare Workers | Application hosting and static assets |
| Cloudflare D1 / SQLite | Accounts, sessions, OAuth grants, spaces, revisions, and usage limits |
| Cloudflare R2 | Current profile pictures |
| Better Auth | Email-code sign-in, browser sessions, OAuth authorization and MCP authentication |
| Resend | Transactional login email delivery |
| Cloudflare Turnstile | Server-verified login challenge |
| Zod and shared services | Input validation, ownership, version checks, and content mutations |
| GitHub Actions / Wrangler | Checks, builds, migrations, secret synchronization, and deployment |

The standalone Worker strips caller-supplied Sites identity headers and uses verified email sessions or OAuth tokens. The Sites-compatible preview remains a separate target with its own trusted authentication gateway and database. Preview identities are not automatically migrated into email accounts.

See [architecture](docs/architecture.md) for storage, authentication, redirect resolution, image cleanup, and resource limits.

## Local development

Use **Node.js 22.13 or newer** and npm.

```sh
npm run install:ci
npm run db:migrate:local
npm run dev
```

The portable development server runs on loopback, normally at `http://127.0.0.1:5173`. Follow its sign-in link to use the simulated local account. This development identity shim is not included in production builds. The basic preview needs no production credentials and does not send real login emails.

`db:migrate:local` applies committed migrations to the same local D1 state used by development, under `.wrangler/state`. Run it after pulling schema changes. Older checkouts that applied SQL manually may need their migration ledger reconciled; do not reset a database containing local work just to fix an “already exists” error.

### VS Code

After installing dependencies, open **Run and Debug**, choose **wya.im: Local development**, and press **F5**. The [launch configuration](.vscode/launch.json) applies local migrations, starts the server, and opens your default browser. Stop it with **Shift+F5**. The Node debugger covers the dev process, not code executing inside the Cloudflare Worker runtime.

### Checks and builds

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run build:cloudflare -- --check
```

`npm run build` builds the Sites-compatible target. `npm run build:cloudflare -- --check` validates a standalone build without production credentials; its placeholder configuration must never be deployed. Both generate build output, so use the appropriate target before previewing or deploying.

`npm start` previews the built Worker locally without the development sign-in shim. For standalone email/OAuth/R2 integration testing, follow the [local integration instructions](docs/deployment.md#local-commands), which use disposable local identities and an in-memory email sink.

## ChatGPT integration

The standalone MCP endpoint is `https://wya.im/mcp`. It uses OAuth with consent and PKCE; see [connection instructions](docs/deployment.md#connect-chatgpt). Availability of custom connections depends on the ChatGPT account or workspace. Hosting this endpoint does not automatically publish the app in a directory.

| Task | MCP tools |
| --- | --- |
| Choose and read a space | `list_spaces`, `get_profile` |
| Create or rename a space | `create_profile`, `rename_space` |
| Update profile details | `update_profile` |
| Manage content | `upsert_link`, `upsert_project`, `delete_link` |
| Organize tabs and sections | `set_tabs`, `set_layout`, `reorder_links` |
| Restore content | `restore_revision` |
| Manage existing pictures | `copy_profile_picture`, `remove_profile_picture` |

Read `get_profile` before mutations and pass its version as `expectedVersion`. Supply `spaceId` when the account has multiple spaces. `get_profile` includes a normalized layout, including an implicit Home tab for older profiles. `set_tabs` edits the whole layout; `set_layout` edits one existing tab. Item upserts accept `tabId`; new items otherwise use the default tab, while edits retain placement when it is omitted.

All private operations derive the account from authentication; callers cannot choose an owner ID. Conflicting edits return an error rather than silently overwriting another session. Browser mutations require same-origin requests. Server-side validation, request limits, and shared mutation quotas also apply to MCP.

## Usernames and short URLs

A link's **display name** is separate from its **URL slug**. Renaming a slug retires its old path unless that path is retained as an alias. Slugs and aliases are unique across the entire space, regardless of tab placement.

Renaming a space makes its previous username immediately available to others. Only the immediately previous username redirects to the space, until someone claims it or the space renames again. A claim does not transfer content, history, or account access. Social username entry constructs a link; it does not verify ownership of an external account.

## Deployment

[`.github/workflows/cloudflare.yml`](.github/workflows/cloudflare.yml) runs tests, lint, typechecking, both builds, and a dry-run Worker upload. A push to `main`, or a manual workflow run on `main`, deploys after checks pass when the repository variable `CLOUDFLARE_DEPLOY_ENABLED` is `true`.

**Obtain explicit owner approval before each deployment**, including deployment-triggering pushes, merges, or workflow retries. Finish local checks first and include any production migrations or infrastructure changes in the approval, as required by [AGENTS.md](AGENTS.md).

The deployment job applies D1 migrations, synchronizes authentication secrets, uploads the Worker, and checks MCP signing-key lookup. D1 and R2 resources are provisioned explicitly. The custom-domain attachment is managed in Cloudflare; CI does not change DNS.

See the [deployment guide](docs/deployment.md) for required secrets and variables, domain/email setup, integration tests, and migration caveats. Keep credentials in ignored local environment files and GitHub/Worker secrets; never commit them. Rolling back application code does not undo database migrations.

## Repository map

| Path | Contents |
| --- | --- |
| `app/` | Pages, dashboard components, API routes, and `/mcp` |
| `lib/` | Content model, validation, layouts, auth, storage services, and limits |
| `db/`, `drizzle/` | Database schema and committed migrations |
| `deployment/` | Standalone Worker and request boundary |
| `scripts/` | Development, build, deployment, and verification helpers |
| `tests/` | Model, database, authentication, security, and integration checks |
| `docs/` | Architecture, deployment, and product planning |

## Planned ideas

See [docs/ideas.md](docs/ideas.md) for interest collections (games, shows, anime, music), an optional personality-type field with visibility controls, covers/backgrounds, alternative page templates, carousels, analytics, and opt-in profile discovery. Premium remains a tentative possibility. These ideas are not implemented features or deployment commitments.
