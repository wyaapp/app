# Architecture

wya.im is one Cloudflare Worker with two ways to manage a profile: the browser dashboard and ChatGPT. Both use the same account ID, validation, profile storage, and revision history.

```mermaid
flowchart LR
  Browser[Browser] --> Worker[Cloudflare Worker\nReact + Vinext]
  Worker --> Auth[Better Auth\nEmail code + sessions + OAuth]
  Auth --> Resend[Resend\nLogin email delivery]
  Auth --> D1[(Cloudflare D1)]
  ChatGPT[ChatGPT] -->|OAuth bearer token| MCP[MCP endpoint /mcp]
  MCP --> Service[Profile service]
  Worker --> Service
  Service --> D1
  GitHub[GitHub Actions] -->|Test, migrate, deploy| Worker
```

These boxes represent responsibilities within one Worker, except Resend, D1, GitHub Actions, and ChatGPT. There is no separate API server or AI API bill for the account-linking feature.

| Part | Implementation | Purpose |
| --- | --- | --- |
| Domain registration | Namecheap | Keeps ownership and renewal of `wya.im` |
| DNS, TLS, hosting | Cloudflare | Domain routing, HTTPS, Worker, static assets |
| UI | React, TypeScript, Vinext, Vite, Tailwind | Landing page, profiles, dashboard, sign-in and consent |
| Database | Cloudflare D1 (SQLite) | Profiles, revisions, users, sessions, hashed codes, OAuth grants and limits |
| Authentication | Better Auth 1.7.10 | Passwordless email sign-in and secure browser cookies |
| Email delivery | Resend Free | Delivers codes from `hello@wya.im`; no marketing emails |
| ChatGPT authorization | Better Auth OAuth/MCP plugins | OAuth authorization code + S256 PKCE, consent, scoped tokens |
| Business rules | Zod and shared `lib/service.ts` | Safe URLs, social usernames, owner isolation, optimistic version checks |
| Deployment | GitHub Actions and Wrangler | Test, build, migrate D1, sync secrets, deploy |

## Sign-in and ChatGPT linking

1. The user enters an email at `/sign-in`. Better Auth creates a six-digit code, stores a hash in D1, and sends the code through Resend.
2. A code expires after five minutes, allows three verification attempts, and can be used once. Persistent IP and recipient limits plus global sending caps restrict abuse. Successful verification creates the internal user and an HttpOnly session cookie. Production cookies are Secure and SameSite=Lax.
3. The dashboard uses that session to resolve the owner ID. Mutation payloads never choose their owner.
4. ChatGPT connects to `https://wya.im/mcp`, discovers the OAuth server, registers an OAuth client, and starts authorization with PKCE. The user signs in with the same email and reviews `/consent`.
5. ChatGPT receives a token bound to `/mcp`. The Worker verifies its signature, issuer, audience, expiry, scopes, and current consent before calling the profile service. Browser cookies cannot authorize MCP calls.
6. `/connections` lets the user disconnect an app. This removes consent and its durable access/refresh tokens; MCP also checks live consent rather than relying on JWT expiry alone.

Scopes are `profile:read`, `profile:write`, and `offline_access`. Access tokens last five minutes; refresh tokens last 30 days. Dynamic client registration supports ChatGPT without a shared client secret. Client names supplied through registration are not verified identities; the consent page also shows the redirect destination. General client/resource administration and machine-to-machine grants are disabled.

The code reserves at most 90 login emails per UTC day and 2,500 per month, below Resend's free-tier sending allowance, with one request per recipient per minute and five per hour. Failed delivery attempts still consume a reservation. These caps protect the budget and can temporarily stop sign-in if exhausted. Resend handles delivery; Better Auth handles identity. Codes, keys, and email message bodies are never logged by the application.

## Storage and updates

Application tables are defined in `db/schema.ts`. Auth tables are managed by Better Auth and the committed additive migration `drizzle/0001_auth.sql`. Keep the two sets of tables separate when generating future migrations. `scripts/generate-auth-migration.mjs` documents how the initial auth SQL was generated; do not overwrite an applied migration when upgrading auth.

- `GET /alex` renders visible links.
- `GET /alex/github` returns a noncached 302 to the saved destination; hidden links return 404.
- Dashboard edits and MCP tools call the same service. Every update records a previous revision and checks the expected version. Stale writes return a conflict.
- Instagram and GitHub usernames expand into URLs. They are not identity verification or social sign-in.

The Sites preview remains a separate deployment and database. It still uses its trusted Sites authentication gateway. The standalone Worker strips all caller-supplied Sites identity headers and only uses independent sessions/OAuth. Existing Sites profiles are not automatically attached to email accounts; any migration needs a verified identity mapping.

## Operations and future work

The custom domain is attached in Cloudflare's dashboard. CI has no DNS permissions and preserves that attachment. Workers.dev and preview URLs stay disabled. Runtime secrets are Cloudflare Worker secrets, mirrored in GitHub Actions for deployment; local copies are ignored and permission-restricted.

Generated profile layouts should reuse structured profile data. Arbitrary hosted HTML would need an isolated rendering boundary. R2 can store future uploads or exports, but this version needs neither R2 nor Redis.

## Link presets and icons

`lib/link-options.ts` defines the shared preset and icon catalog. The dashboard, public cards, Zod validation, and MCP discovery use that catalog. Presets provide a label, suggested slug, destination hint, and default Lucide icon; they do not restrict the destination to a particular host. GitHub and Instagram accept usernames, while other presets require a full HTTP(S) URL.

Links can store an optional `icon` ID independently of `platform` in the existing profile JSON, so no database migration is needed. Old links use the preset default. An omitted icon in `upsert_link` preserves an existing override; `null` clears it. History snapshots retain icons with the rest of the link data. Icon SVGs are bundled with the app; there are no third-party icon requests or uploaded SVGs.
