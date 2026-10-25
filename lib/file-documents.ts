import { AppError } from './app-error.ts';
import { publicItems } from './collections.ts';
import { MAX_COLLECTION_ITEMS } from './collection-types.ts';
import { parsePageSource, projectPageSource } from './page-documents.ts';
import { portableItemsSchema } from './portable-items.ts';
import { actionSchema } from './profile-action-schema.ts';
import { applyProfileLayout } from './profile-tabs.ts';
import { MAX_PROJECTS, type LinkItem, type ProfileData } from './profile-types.ts';

export const FILE_DOCUMENT_TAB_ID = 'file';
const fileOptions = { preserveUnknown: true };

/** Validate file-local cards without assigning them to the space's published link registry. */
export function parseFileDocument(
  source: string,
  options: { publish?: boolean } = {},
): { data: ProfileData; source: string } {
  const parsed = parsePageSource(source, fileOptions);
  const ids = new Set<string>();
  function identify(input: LinkItem, nested = false): LinkItem {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new AppError('Each card must contain a valid item.');
    if (
      input.id !== undefined &&
      (typeof input.id !== 'string' || !input.id || input.id.length > 100)
    )
      throw new AppError('Use a valid item ID.');
    if (
      input.collection &&
      (typeof input.collection !== 'object' || !Array.isArray(input.collection.items))
    )
      throw new AppError('A collection must contain a list of games.');
    if (nested && input.collection)
      throw new AppError('Collections cannot contain other collections.');
    if (input.collection && input.collection.items.length > MAX_COLLECTION_ITEMS)
      throw new AppError(`A collection can contain up to ${MAX_COLLECTION_ITEMS} games.`);
    // The same omitted ID remains stable across rendering and local form edits.
    const id = input.id ?? `legacy:${input.slug}`;
    if (ids.has(id)) throw new AppError('Each item needs a unique ID within this file.');
    ids.add(id);
    return {
      ...input,
      id,
      ...(input.collection
        ? {
            collection: {
              ...input.collection,
              items: input.collection.items.map((item) => identify(item, true)),
            },
          }
        : {}),
    };
  }
  function withoutIdentity(item: LinkItem): unknown {
    const { id: _id, sectionId: _sectionId, ...portable } = item;
    void _id;
    void _sectionId;
    return {
      ...portable,
      ...(item.collection
        ? { collection: { ...item.collection, items: item.collection.items.map(withoutIdentity) } }
        : {}),
    };
  }
  const identified = parsed.items.map(({ item }) => identify(item));
  const validation = portableItemsSchema.safeParse(identified.map(withoutIdentity));
  if (!validation.success)
    throw new AppError(
      validation.error.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join(' '),
    );
  if (identified.filter((item) => item.kind === 'project').length > MAX_PROJECTS)
    throw new AppError('You can have up to 12 projects per file.');
  function restoreIdentity(item: LinkItem, original: LinkItem): LinkItem {
    return {
      ...item,
      id: original.id,
      ...(item.collection && original.collection
        ? {
            collection: {
              ...item.collection,
              items: item.collection.items.map((child, index) =>
                restoreIdentity(child, original.collection!.items[index]),
              ),
            },
          }
        : {}),
    };
  }
  const links = (validation.data as LinkItem[]).map((item, index) =>
    restoreIdentity(item, identified[index]),
  );
  const tab = {
    id: FILE_DOCUMENT_TAB_ID,
    title: 'File',
    slug: 'file',
    ...parsed.layout,
  };
  const layoutValidation = actionSchema.safeParse({
    action: 'set_tabs',
    expectedVersion: 1,
    tabs: [
      {
        ...tab,
        sections: tab.sections.map((section) => ({
          ...section,
          // Empty titles are legitimate intermediate editor states.
          title: !options.publish && !section.title.trim() ? 'Section' : section.title,
        })),
      },
    ],
    defaultTabId: FILE_DOCUMENT_TAB_ID,
  });
  if (!layoutValidation.success)
    throw new AppError('Use valid sections and item placement in the file document.');
  const normalized = projectPageSource(source, links, fileOptions);
  const data = applyProfileLayout(
    { name: 'Markdown file', bio: '', theme: 'lilac', links } satisfies ProfileData,
    { tabs: [tab], defaultTabId: FILE_DOCUMENT_TAB_ID },
  );
  return {
    data: { ...data, documents: { [FILE_DOCUMENT_TAB_ID]: normalized } },
    source: normalized,
  };
}

/** Validate and remove hidden payloads before a published Markdown file crosses the server boundary. */
export function publicFileDocument(source: string): string {
  const parsed = parseFileDocument(source, { publish: true });
  const visible = publicItems(parsed.data.links).filter(
    (item) => !item.collection || item.collection.items.length > 0,
  );
  return projectPageSource(parsed.source, visible, fileOptions);
}
