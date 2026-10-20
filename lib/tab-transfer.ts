import { z } from 'zod';
import { AppError } from './app-error.ts';
import { type LinkItem, type ProfileData } from './profile-types.ts';
import { getProfileLayout, applyProfileLayout, MAX_PROFILE_TABS } from './profile-tabs.ts';
import { MAX_SECTIONS } from './link-layout.ts';
import { allItems } from './collections.ts';
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
  const tab = getProfileLayout(data).tabs.find((tab) => tab.id === tabId);
  if (!tab) throw new AppError('Tab not found.', 404);
  const names = new Set([...tab.ungrouped, ...tab.sections.flatMap((section) => section.slugs)]);
  return parseTabFile({
    format: 'wya.im/tab',
    version: 1,
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
  return result.data;
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
  return {
    data: next,
    tab,
    renames,
    tabSlugChanged: tabSlug !== file.tab.slug,
    itemCount: allItems(items).length,
    hiddenCount: allItems(items).filter((item) => !item.visible).length,
  };
}
