import { AppError, type Profile } from './model.ts';

export const MAX_REDIRECT_LINKS = 10;
const hostedNames = ['wya.im', 'www.wya.im'];
type Lookup = (handle: string) => Promise<Profile | null>;

function shortLink(url: URL, origin?: string) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const localOrigin = origin && url.origin === new URL(origin).origin;
  if (url.port && !localOrigin) return null;
  if (!hostedNames.includes(hostname) && !localOrigin) return null;
  const segments = url.pathname.replace(/\/$/, '').split('/').slice(1);
  if (segments.length !== 2) return null;
  try {
    const [handle, slug] = segments.map(part => decodeURIComponent(part).toLowerCase());
    // Other routes (auth, assets, etc.) are not part of the short-link graph.
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(handle) || !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) return null;
    return {handle, slug};
  } catch { return null; }
}

/** Resolve only our stored redirects. Never fetch arbitrary destination URLs. */
export async function resolveLinkDestination(
  initial: Profile,
  initialSlug: string,
  lookup: Lookup,
  {origin, allowUnavailable = false}: {origin?: string; allowUnavailable?: boolean} = {},
): Promise<string> {
  const visited = new Set<string>();
  let profile = initial, slug = initialSlug.toLowerCase();
  let inheritedHash = '';
  for (let hops = 0; hops < MAX_REDIRECT_LINKS; hops++) {
    // Stable IDs catch cycles through aliases, case changes and encoded paths.
    const key = `${profile.id}/${slug}`;
    if (visited.has(key)) throw new AppError('This link would create a redirect loop. Choose a different destination.', 508);
    visited.add(key);
    const link = profile.links.find(item => item.slug === slug && item.visible);
    if (!link) throw new AppError('This link is unavailable.', 404);
    const url = new URL(link.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new AppError('This link is unavailable.', 404);
    // Match normal redirect fragment inheritance while collapsing the chain.
    if (link.url.includes('#')) inheritedHash = url.hash;
    else if (inheritedHash) url.hash = inheritedHash;
    const target = shortLink(url, origin);
    if (!target) return url.href;
    const next = await lookup(target.handle);
    // A homepage, profile or non-directory application route remains a normal
    // destination. Missing short links may be saved before their target exists;
    // visit-time checks still protect them if a cycle is introduced later.
    if (!next || !next.links.some(item => item.slug === target.slug && item.visible)) {
      if (allowUnavailable || !next) return url.href;
      throw new AppError('This link is unavailable.', 404);
    }
    profile = next;
    slug = target.slug;
  }
  throw new AppError(`This link passes through too many wya.im links (maximum ${MAX_REDIRECT_LINKS}). Use a more direct destination.`, 508);
}
