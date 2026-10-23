import { z } from 'zod';
import { AppError } from './app-error.ts';
import { type LinkItem, type ProfileData } from './profile-types.ts';
import { getProfileLayout, applyProfileLayout, MAX_PROFILE_TABS } from './profile-tabs.ts';
import { MAX_SECTIONS } from './link-layout.ts';
import { allItems } from './collections.ts';
import {
  getPageSource,
  MAX_PAGE_DOCUMENT_BYTES,
  parsePageSource,
  pageDirectiveItem,
  pageDirectiveSection,
  serializePageItem,
  serializePageSection,
  syncPageDocuments,
} from './page-documents.ts';
import type { Nodes } from 'mdast';
import {
  portableItemsSchema,
  portableItem,
  copyPortableItems,
  allocate,
} from './portable-items.ts';

export const TAB_FILE_LIMIT = 1_000_000;
const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/);
export const tabFileSchema = z
  .object({
    format: z.literal('wya.im/tab'),
    version: z.literal(1),
    source: z.string().max(MAX_PAGE_DOCUMENT_BYTES).optional(),
    tab: z
      .object({
        title: z.string().trim().min(1).max(30),
        hidden: z.boolean().optional(),
        slug: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(40),
        ungrouped: z.array(slug).max(100),
        ungroupedPosition: z.number().int().min(0).max(20).optional(),
        sections: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
                title: z.string().trim().min(1).max(60),
                slugs: z.array(slug).max(100),
              })
              .strict(),
          )
          .max(20),
      })
      .strict(),
    items: portableItemsSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
    const placed = [
      ...file.tab.ungrouped,
      ...file.tab.sections.flatMap((section) => section.slugs),
    ];
    if (
      placed.length !== file.items.length ||
      new Set(placed).size !== placed.length ||
      placed.some((slug) => !file.items.some((item) => item.slug === slug))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Every item must appear exactly once in the tab layout.',
      });
    if (
      new Set(file.tab.sections.map((section) => section.id)).size !== file.tab.sections.length ||
      (file.tab.ungroupedPosition ?? 0) > file.tab.sections.length
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid section layout.' });
  });
export type TabFile = z.infer<typeof tabFileSchema>;

export function exportTab(data: ProfileData, tabId: string): TabFile {
  // The layout editor can export a local placement draft. Normalize its source
  // in this snapshot only; exporting must not save or mutate the owner's data.
  if (data.documents) data = syncPageDocuments(data, data);
  const tab = getProfileLayout(data).tabs.find((tab) => tab.id === tabId);
  if (!tab) throw new AppError('Tab not found.', 404);
  const names = new Set([...tab.ungrouped, ...tab.sections.flatMap((section) => section.slugs)]);
  return parseTabFile({
    format: 'wya.im/tab',
    version: 1,
    ...(data.documents?.[tabId] !== undefined ? { source: getPageSource(data, tab) } : {}),
    tab: {
      title: tab.title,
      ...(tab.hidden !== undefined ? { hidden: tab.hidden } : {}),
      slug: tab.slug,
      ungrouped: tab.ungrouped,
      sections: tab.sections,
      ...(tab.ungroupedPosition !== undefined ? { ungroupedPosition: tab.ungroupedPosition } : {}),
    },
    items: data.links.filter((item) => names.has(item.slug)).map(portableItem),
  });
}
export function parseTabFile(value: unknown): TabFile {
  if (new TextEncoder().encode(JSON.stringify(value) ?? '').length > TAB_FILE_LIMIT)
    throw new AppError('Tab files must be under 1 MB.');
  const result = tabFileSchema.safeParse(value);
  if (!result.success)
    throw new AppError(
      `Invalid tab file. ${result.error.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join(' ')}`,
    );
  if (result.data.source !== undefined) {
    const parsed = parsePageSource(result.data.source);
    let payloads: unknown[];
    try {
      payloads = parsed.items.map(({ item }) => portableItem(item));
    } catch {
      throw new AppError('The page source contains an invalid item.');
    }
    const items = portableItemsSchema.safeParse(payloads);
    const layout = (value: typeof parsed.layout) => ({
      ungrouped: value.ungrouped,
      sections: value.sections,
      ungroupedPosition: value.ungroupedPosition ?? 0,
    });
    const bySlug = (values: unknown[]) =>
      [...(values as LinkItem[])].sort((a, b) => a.slug.localeCompare(b.slug));
    if (
      !items.success ||
      JSON.stringify(bySlug(items.data)) !== JSON.stringify(bySlug(result.data.items)) ||
      JSON.stringify(layout(parsed.layout)) !== JSON.stringify(layout(result.data.tab))
    )
      throw new AppError('The page source must match its exported items and sections.');
  }
  return result.data;
}

/** Import independent identities while preserving all prose and Markdown formatting. */
function importedSource(
  file: TabFile,
  tab: TabFile['tab'],
  items: LinkItem[],
  mapping: Map<string, string>,
) {
  const source = file.source!;
  const parsed = parsePageSource(source);
  const newItems = new Map(items.map((item) => [item.slug, item]));
  const sectionIds = new Map(
    file.tab.sections.map((section, index) => [section.id, tab.sections[index].id]),
  );
  const patches: { start: number; end: number; value: string }[] = [];
  const visit = (node: Nodes) => {
    const old = pageDirectiveItem(node);
    if (old) {
      const item = newItems.get(mapping.get(old.slug)!)!;
      patches.push({
        start: node.position!.start.offset!,
        end: node.position!.end.offset!,
        value: serializePageItem(item),
      });
    } else if (node.type === 'containerDirective') {
      const section = pageDirectiveSection(node)!;
      const start = node.position!.start.offset!;
      patches.push({
        start,
        end: source.indexOf('\n', start),
        value: serializePageSection({ ...section, id: sectionIds.get(section.id)! }).split('\n')[0],
      });
      node.children.forEach(visit);
    }
  };
  parsed.tree.children.forEach(visit);
  let next = source;
  for (const patch of patches.sort((a, b) => b.start - a.start))
    next = next.slice(0, patch.start) + patch.value + next.slice(patch.end);
  return next;
}
export function prepareTabImport(data: ProfileData, input: unknown) {
  const file = parseTabFile(input),
    layout = getProfileLayout(data);
  if (layout.tabs.length >= MAX_PROFILE_TABS)
    throw new AppError('You can have up to 5 tabs. Remove a tab before importing.');
  if (
    layout.tabs.reduce((sum, tab) => sum + tab.sections.length, 0) + file.tab.sections.length >
    MAX_SECTIONS
  )
    throw new AppError('Import would exceed 20 sections per space.');
  const { items, mapping, renames } = copyPortableItems(data, file.items as LinkItem[]);
  const tabSlug = allocate(file.tab.slug, new Set(layout.tabs.map((tab) => tab.slug)));
  const tab = {
    ...file.tab,
    id: crypto.randomUUID(),
    slug: tabSlug,
    ungrouped: file.tab.ungrouped.map((slug) => mapping.get(slug)!),
    sections: file.tab.sections.map((section) => ({
      ...section,
      id: crypto.randomUUID(),
      slugs: section.slugs.map((slug) => mapping.get(slug)!),
    })),
  };
  const next = applyProfileLayout(
    { ...data, links: [...data.links, ...items] },
    { ...layout, tabs: [...layout.tabs, tab] },
  );
  if (file.source !== undefined)
    next.documents = { ...next.documents, [tab.id]: importedSource(file, tab, items, mapping) };
  return {
    data: next,
    tab,
    renames,
    tabSlugChanged: tabSlug !== file.tab.slug,
    itemCount: allItems(items).length,
    hiddenCount: allItems(items).filter((item) => !item.visible).length,
  };
}
