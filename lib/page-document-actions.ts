import { AppError } from './app-error.ts';
import { allItems } from './collections.ts';
import { MAX_COLLECTION_ITEMS } from './collection-types.ts';
import { getLayoutGroups, MAX_SECTIONS } from './link-layout.ts';
import { portableItemsSchema } from './portable-items.ts';
import { actionSchema } from './profile-action-schema.ts';
import { applyProfileLayout, getProfileLayout } from './profile-tabs.ts';
import { MAX_PROJECTS, type LinkItem, type ProfileData } from './profile-types.ts';
import { parsePageSource, syncPageDocuments } from './page-documents.ts';
import { normalizeDocumentAppearance, type DocumentAppearance } from './document-appearance.ts';

const identity = (item: LinkItem) => item.id ?? `legacy:${item.slug}`;

/** Reuse the strict import validator without discarding any non-identity fields. */
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

/**
 * Compile a document at the existing profile transaction boundary. Redirects,
 * analytics and legacy views keep using the validated links/tabs projection.
 */
export function compilePageDocument(
  data: ProfileData,
  tabId: string,
  source: string,
  appearance?: DocumentAppearance,
): ProfileData {
  const layout = getProfileLayout(data);
  const tab = layout.tabs.find((tab) => tab.id === tabId);
  if (!tab) throw new AppError('Tab not found.', 404);
  const parsed = parsePageSource(source);
  const slugs = new Set(getLayoutGroups(tab).flatMap((group) => group.slugs));
  const previous = allItems(data.links.filter((item) => slugs.has(item.slug)));
  const existingIds = new Map(previous.map((item) => [identity(item), item]));
  const seenIds = new Set<string>();

  function withIdentity(input: LinkItem, nested = false): LinkItem {
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
    const saved = input.id
      ? existingIds.get(input.id)
      : previous.find((item) => item.slug === input.slug);
    if (input.id && !saved)
      throw new AppError('An item ID must belong to this page. Omit the ID to create a new item.');
    if (saved && saved.kind !== input.kind)
      throw new AppError('Keep the existing item type, or create a new item without its ID.');
    const id = saved ? identity(saved) : crypto.randomUUID();
    if (seenIds.has(id)) throw new AppError('Each item must appear only once in a page document.');
    seenIds.add(id);
    return {
      ...input,
      id,
      ...(input.aliases === undefined && saved?.aliases ? { aliases: saved.aliases } : {}),
      ...(input.collection
        ? {
            collection: {
              ...input.collection,
              items: input.collection.items.map((item) => withIdentity(item, true)),
            },
          }
        : {}),
    };
  }

  const incoming = parsed.items.map(({ item }) => withIdentity(item));
  const untouched = data.links.filter((item) => !slugs.has(item.slug));
  const candidates = [...untouched, ...incoming];
  const validation = portableItemsSchema.safeParse(candidates.map(withoutIdentity));
  if (!validation.success)
    throw new AppError(
      validation.error.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join(' '),
    );
  if (candidates.filter((item) => item.kind === 'project').length > MAX_PROJECTS)
    throw new AppError('You can have up to 12 projects per space.');
  const allIds = allItems(candidates).map(identity);
  if (new Set(allIds).size !== allIds.length)
    throw new AppError('Each item needs a unique ID across this space.');

  function restoreIdentity(validated: LinkItem, original: LinkItem): LinkItem {
    return {
      ...validated,
      ...(original.id ? { id: original.id } : {}),
      ...(original.sectionId ? { sectionId: original.sectionId } : {}),
      ...(validated.collection && original.collection
        ? {
            collection: {
              ...validated.collection,
              items: validated.collection.items.map((item, index) =>
                restoreIdentity(item, original.collection!.items[index]),
              ),
            },
          }
        : {}),
    };
  }
  const normalized = (validation.data as LinkItem[]).map((item, index) =>
    restoreIdentity(item, candidates[index]),
  );
  const tabs = layout.tabs.map((current) =>
    current.id === tabId
      ? {
          ...current,
          ...parsed.layout,
          ...(appearance !== undefined
            ? { appearance: normalizeDocumentAppearance(appearance) }
            : {}),
        }
      : current,
  );
  const sections = tabs.flatMap((current) => current.sections);
  if (
    sections.length > MAX_SECTIONS ||
    new Set(sections.map((item) => item.id)).size !== sections.length
  )
    throw new AppError('Use up to 20 sections with unique IDs across all pages.');
  const validatedLayout = actionSchema.safeParse({
    action: 'set_tabs',
    expectedVersion: 1,
    tabs,
    defaultTabId: layout.defaultTabId,
  });
  if (!validatedLayout.success)
    throw new AppError('Use valid sections and item placement in the page document.');
  const placed = tabs.flatMap((current) =>
    getLayoutGroups(current).flatMap((group) => group.slugs),
  );
  if (
    placed.length !== normalized.length ||
    new Set(placed).size !== normalized.length ||
    placed.some((slug) => !normalized.some((item) => item.slug === slug))
  )
    throw new AppError('Place every item exactly once in its page document.');

  const next = applyProfileLayout({ ...data, links: normalized }, { ...layout, tabs });
  const submitted = { ...next, documents: { ...data.documents, [tabId]: source } };
  return syncPageDocuments(submitted, submitted);
}
