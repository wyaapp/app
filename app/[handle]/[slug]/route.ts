import { getRedirectProfile, getRedirectProfileByDomain } from '@/lib/service';
import { resolveLinkDestination } from '@/lib/link-redirects';
import { AppError, findVisibleLink } from '@/lib/model';
import { DOMAIN_HEADER } from '@/lib/custom-domains';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string; slug: string }> },
) {
  const { handle, slug } = await params;
  const p = await getRedirectProfile(handle);
  const link = p ? findVisibleLink(p, slug) : undefined;
  if (!link)
    return new Response('This link is unavailable.', {
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  try {
    const customDomain =
      request.headers.get(DOMAIN_HEADER) === p!.publicDomain?.hostname && Boolean(p!.publicDomain);
    if (!customDomain && p!.publicDomain?.redirect) {
      const target = new URL(`https://${p!.publicDomain.hostname}/${encodeURIComponent(slug)}`);
      target.search = new URL(request.url).search;
      return new Response(null, {
        status: 302,
        headers: {
          Location: target.href,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }
    const destination = await resolveLinkDestination(p!, link.slug, getRedirectProfile, {
      origin: new URL(request.url).origin,
      customDomain: customDomain ? p!.publicDomain!.hostname : undefined,
      lookupDomain: getRedirectProfileByDomain,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location:
          !customDomain && handle.toLowerCase() !== p!.handle
            ? `/${p!.handle}/${link.slug}`
            : destination,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return new Response(error.message, {
      status: error.status,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
