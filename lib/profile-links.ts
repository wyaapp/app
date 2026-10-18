import { allItems } from './collections.ts';
import type { ProfileData, LinkItem } from './profile-types.ts';

export function findVisibleLink(
  profile: Pick<ProfileData, 'links'>,
  slug: string,
): LinkItem | undefined {
  const name = slug.toLowerCase();
  return allItems(profile.links.filter((link) => link.visible)).find(
    (link) => link.visible && (link.slug === name || link.aliases?.includes(name)),
  );
}
