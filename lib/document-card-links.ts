import type { LinkItem } from './profile-types.ts';

export function documentCardDomId(
  fileId: string | null,
  prefix: string,
  item: Pick<LinkItem, 'id' | 'slug'>,
) {
  return `${fileId ? `file-${fileId}-` : ''}${prefix}-${item.id ?? item.slug}`;
}

/** A copied card may share a slug; only its indexed file owns the short URL. */
export function indexedDocumentCard(
  publishedLinks: readonly LinkItem[],
  fileId: string,
  item: Pick<LinkItem, 'id' | 'slug'>,
) {
  for (const parent of publishedLinks) {
    for (const link of [parent, ...(parent.collection?.items ?? [])]) {
      if (link.fileId === fileId && link.slug === item.slug && (!item.id || link.id === item.id))
        return link;
    }
  }
  return undefined;
}
