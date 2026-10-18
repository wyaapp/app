import { AppError } from './app-error.ts';
import { normalizeDestination } from './profile-validation.ts';
import { type LinkItem, type ProfileData } from './profile-types.ts';
import { catalogUrl } from './catalog-types.ts';
import { suggestInterestSlug } from './interests.ts';
import {
  getProfileLayout,
  applyProfileLayout,
  moveItemToTab,
  reconcileProfileLayout,
} from './profile-tabs.ts';
import { getLayoutGroups } from './link-layout.ts';

export {
  MAX_COLLECTION_ITEMS,
  collectionEntrySchema,
  type CollectionContent,
  type CollectionEntry,
} from './collection-types.ts';
import type { CollectionEntry } from './collection-types.ts';
export function allItems(links: LinkItem[]): LinkItem[] {
  return links.flatMap((item) => [item, ...(item.collection?.items ?? [])]);
}
export function publicItems(links: LinkItem[]): LinkItem[] {
  return links
    .filter((item) => item.visible)
    .map((item) =>
      item.collection
        ? {
            ...item,
            collection: {
              ...item.collection,
              items: item.collection.items.filter((child) => child.visible),
            },
          }
        : item,
    );
}
export function hasCatalogItems(links: LinkItem[]) {
  return allItems(links).some((item) => item.interest?.catalog?.provider === 'igdb');
}
function ensureCapacity(data: ProfileData) {
  if (allItems(data.links).length > 100)
    throw new AppError('You can have up to 100 items per space, including games inside widgets.');
}
export function saveCollection(
  data: ProfileData,
  input: {
    slug: string;
    originalSlug?: string;
    label?: string;
    entries: CollectionEntry[];
    visible?: boolean;
    createOnly?: boolean;
    tabId?: string;
  },
) {
  const previous = data.links.find((item) => item.slug === (input.originalSlug ?? input.slug));
  if (input.originalSlug !== undefined && !previous)
    throw new AppError('Collection not found. Reload this space before editing it.', 404);
  if (previous && (previous.kind !== 'collection' || input.createOnly))
    throw new AppError('That URL slug is already used.');
  if (input.tabId && !getProfileLayout(data).tabs.some((tab) => tab.id === input.tabId))
    throw new AppError('Tab not found.', 404);
  const reserved = allItems(data.links).flatMap((item) => [item.slug, ...(item.aliases ?? [])]);
  if (
    allItems(data.links).some(
      (item) => item !== previous && [item.slug, ...(item.aliases ?? [])].includes(input.slug),
    ) ||
    previous?.aliases?.includes(input.slug)
  )
    throw new AppError('That URL slug or alias is already used.');
  reserved.push(input.slug);
  const seenIds = new Set<string>(),
    seenGames = new Set<number>();
  const items = input.entries.map((entry) => {
    let item: LinkItem;
    if ('id' in entry) {
      const saved = previous?.collection?.items.find((item) => item.id === entry.id);
      if (!saved || seenIds.has(entry.id))
        throw new AppError('Choose each game from this widget only once.');
      seenIds.add(entry.id);
      item = structuredClone(saved);
      if (entry.visible !== undefined) item.visible = entry.visible;
    } else {
      const { game } = entry;
      const coverUrl = game.coverUrl ? normalizeDestination('website', game.coverUrl) : undefined;
      if (coverUrl && !coverUrl.startsWith('https://'))
        throw new AppError('Use an HTTPS image URL for the cover.');
      const slug = suggestInterestSlug(game.title, reserved, 'game');
      reserved.push(slug);
      const url = catalogUrl(game.source);
      item = {
        id: crypto.randomUUID(),
        slug,
        label: game.title,
        url,
        platform: 'website',
        icon: 'gamepad',
        kind: 'interest',
        visible: true,
        interest: {
          type: 'game',
          note: '',
          favorite: false,
          catalog: game.source,
          ...(coverUrl ? { coverUrl } : {}),
          buttons: [],
        },
      };
    }
    const gameId = item.interest?.catalog?.id;
    if (gameId !== undefined) {
      if (seenGames.has(gameId)) throw new AppError('This game is already in the widget.');
      seenGames.add(gameId);
    }
    if (entry.buttons !== undefined) {
      const normalized = entry.buttons.map((button) => ({
        label: button.label,
        url: normalizeDestination('website', button.destination),
      }));
      item.interest = { ...item.interest!, buttons: normalized };
      item.url = normalized[0]?.url ?? '';
    }
    return item;
  });
  const widget: LinkItem = {
    ...previous,
    id: previous?.id ?? crypto.randomUUID(),
    slug: input.slug,
    label: input.label ?? previous?.label ?? '',
    kind: 'collection',
    platform: 'website',
    icon: 'gamepad',
    url: '',
    visible: input.visible ?? previous?.visible ?? false,
    collection: { type: 'game', items },
  };
  const next = {
    ...data,
    links: previous
      ? data.links.map((item) => (item === previous ? widget : item))
      : [...data.links, widget],
  };
  ensureCapacity(next);
  if (next.tabs) {
    let layout = reconcileProfileLayout(
      getProfileLayout(data),
      next,
      previous && previous.slug !== input.slug
        ? { from: previous.slug, to: input.slug }
        : undefined,
    );
    if (
      input.tabId &&
      !getLayoutGroups(layout.tabs.find((tab) => tab.id === input.tabId)!).some((group) =>
        group.slugs.includes(widget.slug),
      )
    )
      layout = moveItemToTab(layout, widget.slug, input.tabId);
    return applyProfileLayout(next, layout);
  }
  return next;
}
/** Explicit conversion only; keep each child's stable address and full snapshot. */
export function groupGames(
  data: ProfileData,
  input: { slug: string; label?: string; slugs: string[] },
) {
  if (new Set(input.slugs).size !== input.slugs.length)
    throw new AppError('Choose each game only once.');
  if (
    allItems(data.links).some((item) => [item.slug, ...(item.aliases ?? [])].includes(input.slug))
  )
    throw new AppError('That URL slug is already used.');
  const layout = getProfileLayout(data);
  const location = (slug: string) =>
    layout.tabs
      .flatMap((tab) =>
        getLayoutGroups(tab).map((group) => ({ tab: tab.id, group: group.id, slugs: group.slugs })),
      )
      .find((group) => group.slugs.includes(slug));
  const first = location(input.slugs[0]);
  const items = input.slugs.map((slug) => {
    const item = data.links.find((item) => item.slug === slug),
      place = location(slug);
    if (item?.kind !== 'interest' || item.interest?.type !== 'game')
      throw new AppError('Choose existing individual games to group.');
    if (place?.tab !== first?.tab || place?.group !== first?.group)
      throw new AppError('Group games from the same tab and section. Move them together first.');
    return { ...item, id: item.id ?? `legacy:${item.slug}` };
  });
  const catalogIds = items.flatMap((item) =>
    item.interest?.catalog ? [item.interest.catalog.id] : [],
  );
  if (new Set(catalogIds).size !== catalogIds.length)
    throw new AppError('Choose each catalog game only once per widget.');
  const selected = new Set(input.slugs);
  const ordered = data.links.filter((item) => selected.has(item.slug));
  const widget: LinkItem = {
    id: crypto.randomUUID(),
    slug: input.slug,
    label: input.label ?? '',
    kind: 'collection',
    platform: 'website',
    icon: 'gamepad',
    url: '',
    visible: true,
    collection: {
      type: 'game',
      items: ordered.map((item) => items.find((child) => child.slug === item.slug)!),
    },
    ...(ordered[0].sectionId ? { sectionId: ordered[0].sectionId } : {}),
  };
  let inserted = false;
  const replace = (slugs: string[]) =>
    slugs.flatMap((slug) => {
      if (!selected.has(slug)) return [slug];
      if (inserted) return [];
      inserted = true;
      return [widget.slug];
    });
  const updatedLayout = {
    ...layout,
    tabs: layout.tabs.map((tab) => ({
      ...tab,
      ungrouped: replace(tab.ungrouped),
      sections: tab.sections.map((section) => ({ ...section, slugs: replace(section.slugs) })),
    })),
  };
  const next = {
    ...data,
    links: [...data.links.filter((item) => !selected.has(item.slug)), widget],
  };
  ensureCapacity(next);
  return applyProfileLayout(next, updatedLayout);
}
