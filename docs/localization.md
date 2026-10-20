# Website languages

The website supports English and Portuguese (Brazil). The `wya-locale` preference cookie takes priority over the browser's `Accept-Language` header. Unsupported preferences fall back to English. Portuguese browser variants use pt-BR.

Language switching updates client controls and refreshes server-rendered copy without changing the URL. The cookie lasts one year and does not identify a user. There are no locale URL prefixes, database migrations, or translated copies of spaces. Handles, destinations, titles, bios, and other user content keep their original values.

- `lib/i18n/locale.ts`: supported locales and browser negotiation.
- `lib/i18n/pt-BR.ts`: Portuguese application copy. English source messages serve as keys and fallback text.
- `lib/i18n/server.ts`: request-scoped locale and translator for server pages.
- `app/components/language-provider.tsx`: client context and preference switching.
- `app/components/language-switcher.tsx`: shared accessible selector.

Use `await getTranslator()` in server pages and `useTranslation()` in client components. Translate application copy at render time, including labels and accessible names; never translate saved user content or change stable API values. Use placeholders for variable messages, for example `t('Open {name}', { name: item.label })`. Date and number formatting must use the selected locale.

Existing API/MCP contracts remain in English. Known user-facing error messages are translated when shown in the UI; unknown upstream errors fall back to the original message. Login emails remain in English. Game catalog titles come from IGDB and are not machine-translated.

The privacy and terms pages have matching translations and remain drafts. Neither translation changes their existing review status.

Checks: `npm test`, `npm run typecheck`, `npm run lint`, and the local Cloudflare build. Check language switching in the browser, including an open unsaved form, and verify the public page still displays user content verbatim.
