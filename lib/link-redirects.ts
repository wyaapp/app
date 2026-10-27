import { AppError } from './app-error.ts';
import { normalizeDestination } from './profile-validation.ts';
import { findVisibleLink } from './profile-links.ts';
import type { Profile } from './profile-types.ts';
import { documentCardDomId } from './document-card-links.ts';

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
    const [handle, slug] = segments.map((part) => decodeURIComponent(part).toLowerCase());
    // Other routes (auth, assets, etc.) are not part of the short-link graph.
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(handle) || !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) return null;
    return { handle, slug };
  } catch {
    return null;
  }
}

/** Resolve only our stored redirects. Never fetch arbitrary destination URLs. */
export async function resolveLinkDestination(
  initial: Profile,
  initialSlug: string,
  lookup: Lookup,
  {
    origin,
    customDomain,
    lookupDomain,
    allowUnavailable = false,
  }: {
    origin?: string;
    customDomain?: string;
    lookupDomain?: Lookup;
    allowUnavailable?: boolean;
  } = {},
): Promise<string> {
  const visited = new Set<string>();
  let profile = initial,
    slug = initialSlug.toLowerCase();
  let inheritedHash = '';
  for (let hops = 0; hops < MAX_REDIRECT_LINKS; hops++) {
    // Stable IDs catch cycles through aliases, case changes and encoded paths.
    const link = findVisibleLink(profile, slug);
    if (!link) throw new AppError('This link is unavailable.', 404);
    const key = `${profile.id}/${link.fileId ?? ''}/${link.id ?? link.slug}`;
    if (visited.has(key))
      throw new AppError(
        'This link would create a redirect loop. Choose a different destination.',
        508,
      );
    visited.add(key);
    if (
      (link.kind === 'interest' || link.kind === 'collection' || link.kind === 'discord') &&
      !link.url
    ) {
      const url = new URL(
        customDomain && profile.id === initial.id ? '/' : `/${profile.handle}`,
        customDomain && profile.id === initial.id
          ? `https://${customDomain}`
          : customDomain
            ? 'https://wya.im'
            : origin || 'https://wya.im',
      );
      url.hash = documentCardDomId(
        link.fileId ?? null,
        link.kind === 'collection' || link.kind === 'discord' ? 'widget' : 'interest',
        link,
      );
      return url.href;
    }
    if (link.platform === 'email') return normalizeDestination('email', link.url);
    const url = new URL(link.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new AppError('This link is unavailable.', 404);
    // Match normal redirect fragment inheritance while collapsing the chain.
    if (link.url.includes('#')) inheritedHash = url.hash;
    else if (inheritedHash) url.hash = inheritedHash;
    const ownCustomLink =
      !url.port &&
      ((customDomain && url.hostname === customDomain) ||
        (initial.publicDomain && url.hostname === initial.publicDomain.hostname));
    const ownSlug = /^\/([a-z0-9][a-z0-9._-]*)\/?$/i.exec(url.pathname)?.[1];
    const otherDomain =
      !url.port && !ownCustomLink && ownSlug && lookupDomain
        ? await lookupDomain(url.hostname)
        : null;
    const target =
      (ownCustomLink || otherDomain) && ownSlug
        ? { handle: otherDomain?.handle ?? initial.handle, slug: ownSlug.toLowerCase() }
        : shortLink(url, origin);
    if (!target) return url.href;
    const next = await lookup(target.handle);
    // A homepage, profile or non-directory application route remains a normal
    // destination. Missing short links may be saved before their target exists;
    // visit-time checks still protect them if a cycle is introduced later.
    if (!next || !findVisibleLink(next, target.slug)) {
      if (allowUnavailable || !next) return url.href;
      throw new AppError('This link is unavailable.', 404);
    }
    profile = next;
    slug = target.slug;
  }
  throw new AppError(
    `This link passes through too many wya.im links (maximum ${MAX_REDIRECT_LINKS}). Use a more direct destination.`,
    508,
  );
}
