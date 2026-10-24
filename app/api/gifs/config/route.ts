import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

/** GIPHY requires direct browser requests, so this key is intentionally public. */
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const origin = request.headers.get('origin');
  if (
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    (origin && origin !== new URL(request.url).origin)
  ) {
    return Response.json({ error: 'Invalid request origin.' }, { status: 403, headers });
  }
  return Response.json({ apiKey: env.GIPHY_API_KEY?.trim() || null }, { headers });
}
