import { z } from 'zod';
import { AppError } from './app-error.ts';
import type { LinkItem, ProfileData } from './profile-types.ts';
import { portableItemsSchema, portableItem, copyPortableItems } from './portable-items.ts';
import { applyProfileLayout, getProfileLayout } from './profile-tabs.ts';
import { MAX_SECTIONS } from './link-layout.ts';
import { allItems } from './collections.ts';

export const CLIPBOARD_LIMIT = 1_000_000;
export const clipboardSchema = z.discriminatedUnion('kind', [
  z
    .object({
      format: z.literal('wya.im/clipboard'),
      version: z.literal(1),
      kind: z.literal('item'),
      items: portableItemsSchema.refine((items) => items.length === 1, 'Copy one item at a time.'),
    })
    .strict(),
  z
    .object({
      format: z.literal('wya.im/clipboard'),
      version: z.literal(1),
      kind: z.literal('section'),
      title: z.string().trim().min(1).max(60),
      items: portableItemsSchema,
    })
    .strict(),
]);
export type ClipboardContent = z.infer<typeof clipboardSchema>;

export function parseClipboard(value: unknown): ClipboardContent {
  if (new TextEncoder().encode(JSON.stringify(value) ?? '').length > CLIPBOARD_LIMIT)
    throw new AppError('Copied content must be under 1 MB.');
  const parsed = clipboardSchema.safeParse(value);
  if (!parsed.success) throw new AppError('Copy an item or section from Wya first.');
  return parsed.data;
}

export function copyItem(data: ProfileData, slug: string): ClipboardContent {
  const item = data.links.find((item) => item.slug === slug);
  if (!item) throw new AppError('Item not found.', 404);
  return parseClipboard({
    format: 'wya.im/clipboard',
    version: 1,
    kind: 'item',
    items: [portableItem(item)],
  });
}

export function copySection(data: ProfileData, sectionId: string): ClipboardContent {
  const section = getProfileLayout(data)
    .tabs.flatMap((tab) => tab.sections)
    .find((section) => section.id === sectionId);
  if (!section) throw new AppError('Section not found.', 404);
  return parseClipboard({
    format: 'wya.im/clipboard',
    version: 1,
    kind: 'section',
    title: section.title,
    items: section.slugs.map((slug) =>
      portableItem(data.links.find((item) => item.slug === slug)!),
    ),
  });
}

/** Always append independent copies; never replace existing content. */
export function prepareContentPaste(
  data: ProfileData,
  input: unknown,
  tabId: string,
  sectionId?: string,
) {
  const content = parseClipboard(input),
    layout = getProfileLayout(data);
  const tab = layout.tabs.find((tab) => tab.id === tabId);
  if (!tab) throw new AppError('Tab not found.', 404);
  const section = sectionId ? tab.sections.find((section) => section.id === sectionId) : undefined;
  if (sectionId && !section) throw new AppError('Section not found in this tab.', 404);
  if (content.kind === 'section' && sectionId)
    throw new AppError('Paste sections into a tab, not inside another section.');
  if (
    content.kind === 'section' &&
    layout.tabs.reduce((count, tab) => count + tab.sections.length, 0) >= MAX_SECTIONS
  )
    throw new AppError('You can have up to 20 sections per space.');
  const { items, renames } = copyPortableItems(data, content.items as LinkItem[]);
  const slugs = items.map((item) => item.slug);
  if (content.kind === 'section') {
    tab.sections.push({ id: crypto.randomUUID(), title: content.title, slugs });
  } else {
    (section?.slugs ?? tab.ungrouped).push(...slugs);
  }
  return {
    data: applyProfileLayout({ ...data, links: [...data.links, ...items] }, layout),
    renames,
    itemCount: allItems(items).length,
    hiddenCount: allItems(items).filter((item) => !item.visible).length,
  };
}
