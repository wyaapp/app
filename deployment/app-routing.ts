import { parseDashboardRoute } from '../lib/dashboard-routes.ts';

const jsonNotFound = () => Response.json({ error: 'Not found.' }, { status: 404 });

/** The dashboard host serves static UI. It never enters public profile rendering. */
export async function routeAppRequest(
  request: Request,
  appOrigin: string | undefined,
  assets: Pick<Fetcher, 'fetch'> | undefined,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!appOrigin || url.origin !== new URL(appOrigin).origin) return null;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return null;
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const page =
    url.pathname === '/' ||
    ['/sign-in', '/sign-out'].includes(url.pathname) ||
    parseDashboardRoute(url);
  if (page) {
    if (!assets) return new Response('Dashboard assets unavailable.', { status: 503 });
    const asset = new URL('/_app/index.html', url);
    const response = await assets.fetch(new Request(asset, { method: request.method }));
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-cache');
    headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    );
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('Referrer-Policy', 'no-referrer');
    return new Response(response.body, { status: response.status, headers });
  }
  if (
    url.pathname.startsWith('/_app/') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname === '/favicon.svg'
  )
    return assets ? assets.fetch(request) : jsonNotFound();
  return new Response('Page not found.', { status: 404 });
}
