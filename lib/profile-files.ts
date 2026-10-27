import { publicFileDocument, parseFileDocument } from './file-documents.ts';
import type { LinkItem } from './profile-types.ts';
import { fileBytes, type SpaceFile } from './space-files.ts';
import { getFileFormat, isRichTextFile } from './file-formats.ts';
import { parseWidgetSource } from './widget-files.ts';

function orderedFiles(files: readonly SpaceFile[]) {
  return [...files].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id),
  );
}

/** Published snapshots are the only file content allowed across the public boundary. */
export function publicProfileFiles(files: readonly SpaceFile[]): SpaceFile[] {
  return orderedFiles(files).flatMap((file) => {
    if (!file.published) return [];
    // Public reads already use their published snapshot as the normal fields.
    // An owner row with a changed draft must include its separate snapshot.
    const snapshot = file.version === 0 || !file.hasChanges;
    const name = file.publishedName ?? (snapshot ? file.name : undefined);
    const source = file.publishedContent ?? (snapshot ? file.content : undefined);
    if (name === undefined || source === undefined) return [];
    let content: string;
    try {
      content = isRichTextFile(name) ? publicFileDocument(source) : source;
      if (getFileFormat(name) === 'widget') parseWidgetSource(content, { allowEmpty: false });
    } catch {
      // A malformed stored document must not disclose unvalidated card payloads.
      return [];
    }
    return [
      {
        id: file.id,
        name,
        content,
        folderId: file.folderId,
        size: fileBytes(content),
        version: 0,
        published: true,
        hasChanges: false,
        pinned: file.pinned,
        updatedAt: file.publishedAt ?? file.updatedAt,
        appearance: file.publishedAppearance ?? (snapshot ? file.appearance : undefined),
        position: file.position ?? 0,
        ...(file.legacyTabId ? { legacyTabId: file.legacyTabId } : {}),
      },
    ];
  });
}

/**
 * Short URLs are a derived index, never another editable content store.
 * Migrated pages retain their old short URLs. Within each priority group,
 * stable file identity keeps ownership independent of navigation reordering.
 */
export function profileFileLinks(files: readonly SpaceFile[], publicOnly: boolean): LinkItem[] {
  const claimed = new Set<string>();
  const result: LinkItem[] = [];
  const candidates = [...(publicOnly ? publicProfileFiles(files) : files)].sort(
    (a, b) => Number(!a.legacyTabId) - Number(!b.legacyTabId) || a.id.localeCompare(b.id),
  );
  for (const file of candidates) {
    if (!isRichTextFile(file.name)) continue;
    let links: LinkItem[];
    try {
      links = parseFileDocument(file.content).data.links;
    } catch {
      continue;
    }
    function index(item: LinkItem): LinkItem | null {
      if (claimed.has(item.slug)) return null;
      claimed.add(item.slug);
      const aliases = (item.aliases ?? []).filter((alias) => {
        if (claimed.has(alias)) return false;
        claimed.add(alias);
        return true;
      });
      return {
        ...item,
        fileId: file.id,
        ...(item.aliases ? { aliases } : {}),
        ...(item.collection
          ? {
              collection: {
                ...item.collection,
                items: item.collection.items.flatMap((child) => {
                  const indexed = index(child);
                  return indexed ? [indexed] : [];
                }),
              },
            }
          : {}),
      };
    }
    for (const item of links) {
      const indexed = index(item);
      if (indexed) result.push(indexed);
    }
  }
  return result;
}
