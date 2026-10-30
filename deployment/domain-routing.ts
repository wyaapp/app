import { DOMAIN_HEADER, domainIsActive, type DomainRow } from '../lib/custom-domains.ts';

const unavailable = () =>
  new Response('This domain is not connected to an active space.', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
const privatePaths = [
  '/dashboard',
  '/experimental-dashboard',
  '/sign-in',
  '/signin-with-chatgpt',
  '/signout-with-chatgpt',
  '/connections',
  '/consent',
  '/callback',
  '/mcp',
  '/.well-known',
];
type DomainLookup = (hostname: string) => Promise<(DomainRow & { handle: string }) | null>;

/** Host comes from the actual request URL, never forwarded/client-supplied headers. */
export async function routeDomainRequest(
  request: Request,
  origin: string,
  lookup: DomainLookup,
  appOrigin?: string,
): Promise<Request | Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete(DOMAIN_HEADER);
  const canonical = new URL(origin);
  if (
    (appOrigin && url.origin === new URL(appOrigin).origin) ||
    url.hostname === canonical.hostname ||
    (canonical.hostname === 'wya.im' && url.hostname === 'www.wya.im')
  )
    return new Request(request, { headers });
  const domain = await lookup(url.hostname);
  if (!domain || !domainIsActive(domain)) return unavailable();
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed.', {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  // Customer origins never receive account pages, session cookies or privileged APIs.
  headers.delete('cookie');
  // Only the non-sensitive language preference is useful on a public custom domain.
  const locale = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => /^wya-locale=(en|pt-BR)$/.test(part));
  if (locale) headers.set('cookie', locale);
  headers.delete('authorization');
  for (const key of [...headers.keys()])
    if (key.startsWith('oai-authenticated-user-')) headers.delete(key);
  if (privatePaths.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
    const destination = new URL(url.pathname + url.search, canonical);
    return new Response(null, {
      status: 302,
      headers: { Location: destination.href, 'Cache-Control': 'no-store' },
    });
  }
  const publicApi =
    /^\/api\/pictures\/[^/]+$/.test(url.pathname) ||
    url.pathname === '/api/gifs/config' ||
    (url.pathname === '/api/public-files' && url.searchParams.get('handle') === domain.handle) ||
    (url.pathname === '/api/discord-widget' &&
      !url.searchParams.has('guildId') &&
      url.searchParams.get('handle') === domain.handle);
  if (url.pathname.startsWith('/api/') && !publicApi) return unavailable();
  if (
    publicApi ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/giphy/powered-by-giphy.png' ||
    ['/favicon.ico', '/favicon.svg'].includes(url.pathname)
  )
    return new Request(request, { headers });
  if (url.pathname === '/robots.txt')
    return new Response('User-agent: *\nAllow: /\n', { headers: { 'Content-Type': 'text/plain' } });
  // One profile and one-segment short links only. Never expose another space here.
  if (url.pathname !== '/' && !/^\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}\/?$/.test(url.pathname))
    return unavailable();
  headers.set(DOMAIN_HEADER, domain.hostname);
  url.pathname = `/${domain.handle}${url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')}`;
  headers.set('host', url.host);
  return new Request(url, { method: request.method, headers });
}
