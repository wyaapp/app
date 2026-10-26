import { PICTURE_TYPES } from './picture-limits.ts';
import { initialsKey } from './initials-avatar.ts';

export const AVATAR_CACHE_SECONDS = 60;
const MISSING_CACHE_SECONDS = 5;
const CACHED_AT = 'X-Wya-Avatar-Cached-At';
const handlePattern = /^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$/;

type AvatarRoute = { handle: string; literalHandle: string | null };
type AvatarRow = {
  matched_handle: string;
  handle: string;
  name: string | null;
  picture_key: string | null;
};
type AvatarCache = Pick<Cache, 'match' | 'put'>;
type AvatarOptions = {
  cache?: AvatarCache | null;
  now?: () => number;
  renderInitials?: (name: string, handle: string) => Promise<Response>;
};

/** One path segment only. Never intercept assets, short links or custom-domain rewrites. */
export function avatarRequest(pathname: string): AvatarRoute | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname).toLowerCase();
  } catch {
    return null;
  }
  const api = /^\/api\/avatars\/([^/]+)$/.exec(path);
  if (api) return handlePattern.test(api[1]) ? { handle: api[1], literalHandle: null } : null;
  const image = /^\/([^/]+)\.png$/.exec(path);
  if (!image || !handlePattern.test(image[1])) return null;
  return { handle: image[1], literalHandle: `${image[1]}.png` };
}

function publicHeaders(seconds = AVATAR_CACHE_SECONDS) {
  return new Headers({
    'Cache-Control': `public, max-age=${seconds}, must-revalidate`,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
}

function unavailable() {
  return new Response('Profile picture is temporarily unavailable.', {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
  });
}

function edgeCache(): AvatarCache | null {
  try {
    return typeof caches === 'undefined'
      ? null
      : ((caches as CacheStorage & { default?: AvatarCache }).default ?? null);
  } catch {
    return null;
  }
}

function matchesEtag(request: Request, etag: string | null) {
  if (!etag) return false;
  return (request.headers.get('if-none-match') ?? '').split(',').some((value) => {
    const candidate = value.trim();
    return candidate === '*' || candidate.replace(/^W\//, '') === etag.replace(/^W\//, '');
  });
}

function forClient(response: Response, request: Request, now: number) {
  const headers = new Headers(response.headers);
  const cachedAt = headers.get(CACHED_AT);
  if (cachedAt)
    headers.set('Age', String(Math.max(0, Math.floor((now - Number(cachedAt)) / 1000))));
  headers.delete(CACHED_AT);
  const unchanged = response.status === 200 && matchesEtag(request, headers.get('etag'));
  if (unchanged || request.method === 'HEAD') {
    void response.body?.cancel();
    if (unchanged) headers.delete('Content-Length');
    return new Response(null, { status: unchanged ? 304 : response.status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}

async function initialsEtag(name: string, handle: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(initialsKey(name, handle)),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `"${hex}"`;
}

/** Public image fast path: one indexed read on a miss, no profile hydration or session lookup. */
export async function routeProfileAvatar(
  request: Request,
  env: Pick<Cloudflare.Env, 'DB' | 'PICTURES'>,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  options: AvatarOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const route = avatarRequest(url.pathname);
  if (!route) return null;
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed.', {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  if (!env.DB) return unavailable();
  const now = options.now ?? Date.now;
  const cache = options.cache === undefined ? edgeCache() : options.cache;
  // Cookies, query strings and conditional headers never fragment or poison this public cache.
  // Keep the unambiguous API separate from the route that preserves literal .png profile pages.
  const key = new Request(
    `${url.origin}/__wya_avatar/v1/${route.literalHandle ? 'alias' : 'api'}/${route.handle}`,
  );
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return forClient(hit, request, now());
    } catch {
      // An unavailable cache must not take the public picture offline.
    }
  }
  const started = now();
  try {
    const row = await env.DB.prepare(
      `SELECT h.handle AS matched_handle, s.handle, s.picture_key,
        json_extract(s.data, '$.name') AS name
       FROM space_handles h JOIN spaces s ON s.id = h.space_id
       WHERE h.handle IN (?, ?)
       ORDER BY CASE WHEN h.handle = ? THEN 0 ELSE 1 END LIMIT 1`,
    )
      .bind(route.handle, route.literalHandle, route.literalHandle)
      .first<AvatarRow>();
    // Dots are legal in existing usernames. Their profile page keeps precedence;
    // /api/avatars/<handle> remains available when both 'alex' and 'alex.png' exist.
    if (row && row.matched_handle === route.literalHandle) return null;

    let response: Response;
    if (!row) {
      const headers = publicHeaders(MISSING_CACHE_SECONDS);
      headers.set('Content-Type', 'text/plain; charset=utf-8');
      response = new Response('Profile not found.', { status: 404, headers });
    } else {
      const headers = publicHeaders();
      let body: BodyInit | null = null;
      if (row.picture_key) {
        if (!env.PICTURES) return unavailable();
        // HEAD does not download an object, even on a cold edge.
        const object = await (request.method === 'HEAD'
          ? env.PICTURES.head(row.picture_key)
          : env.PICTURES.get(row.picture_key));
        if (object) {
          const type = object.httpMetadata?.contentType || 'image/webp';
          if (!PICTURE_TYPES.some((supported) => supported === type)) return unavailable();
          headers.set('Content-Type', type);
          headers.set('Content-Length', String(object.size));
          headers.set('ETag', object.httpEtag);
          if ('body' in object) body = object.body as ReadableStream;
        }
      }
      if (!headers.has('Content-Type')) {
        const name = typeof row.name === 'string' ? row.name : '';
        headers.set('Content-Type', 'image/png');
        headers.set('ETag', await initialsEtag(name, row.handle));
        // No renderer/WASM load for uploads, HEAD or a revalidation with matching initials.
        if (request.method !== 'HEAD' && !matchesEtag(request, headers.get('ETag'))) {
          const render =
            options.renderInitials ?? (await import('./initials-avatar.ts')).renderInitialsAvatar;
          const image = await render(name, row.handle);
          if (!image.ok) return unavailable();
          body = image.body;
        } else {
          return forClient(new Response(null, { headers }), request, now());
        }
      }
      response = new Response(body, { headers });
    }
    // A cold HEAD never seeds an empty GET response. Long-running misses may not
    // extend freshness beyond the read's start, including a slow initial PNG render.
    const lifetime = response.status === 404 ? MISSING_CACHE_SECONDS : AVATAR_CACHE_SECONDS;
    const remaining = Math.max(0, lifetime - Math.ceil((now() - started) / 1000));
    response.headers.set('Cache-Control', `public, max-age=${remaining}, must-revalidate`);
    response.headers.set(CACHED_AT, String(now()));
    if (cache && remaining > 0 && request.method === 'GET') {
      const stored = response.clone();
      ctx.waitUntil(cache.put(key, stored).catch(() => {}));
    }
    return forClient(response, request, now());
  } catch {
    // Neither database details nor storage credentials belong in this public response.
    return unavailable();
  }
}
