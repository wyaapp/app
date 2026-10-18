import type { LinkItem } from './profile-types';

export function itemLabel(item: LinkItem): string {
  return item.label || (item.kind === 'collection' ? 'Game Collection' : item.slug);
}
