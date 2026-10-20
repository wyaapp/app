import { z } from 'zod';
import { tabFileSchema } from './tab-transfer.ts';
import { clipboardSchema } from './content-clipboard.ts';
import { collectionEntrySchema, MAX_COLLECTION_ITEMS } from './collection-types.ts';
import { itemButtonSchema, MAX_ITEM_BUTTONS } from './item-buttons.ts';
import { interestTypes, interestStatuses } from './interests.ts';
import { MAX_PROFILE_TABS } from './profile-tabs.ts';
import { MAX_SECTIONS } from './link-layout.ts';
import { themeIds } from './profile-themes.ts';
import { platforms, iconIds } from './link-options.ts';
import { MAX_LINK_ALIASES } from './profile-types.ts';
import { discordGuildId } from './discord-widget-types.ts';

const spaceId = z.string().trim().min(1).max(160).optional();
export const spaceSelectorSchema = z.object({ spaceId }).strict();
const version = z.number().int().positive();
export const pictureActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('remove_profile_picture'),
      spaceId: z.string().min(1).max(160),
      expectedVersion: version,
    })
    .strict(),
  z
    .object({
      action: z.literal('copy_profile_picture'),
      spaceId: z.string().min(1).max(160),
      sourceSpaceId: z.string().min(1).max(160),
      expectedVersion: version,
    })
    .strict(),
]);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/,
    'Use 1–40 letters, numbers, dots, underscores, or hyphens for the URL slug. Start and end with a letter or number.',
  );
const tabId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const layoutFields = {
  ungroupedPosition: z.number().int().min(0).max(MAX_SECTIONS).optional(),
  ungrouped: z.array(slug).max(100),
  sections: z
    .array(
      z
        .object({
          id: tabId,
          title: z.string().trim().min(1).max(60),
          slugs: z.array(slug).max(100),
        })
        .strict(),
    )
    .max(MAX_SECTIONS),
};
export const actionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('paste_content'),
      expectedVersion: version,
      spaceId,
      tabId,
      sectionId: tabId.optional(),
      content: z.lazy(() => clipboardSchema),
    })
    .strict(),
  z
    .object({
      action: z.literal('upsert_discord'),
      expectedVersion: version,
      spaceId,
      tabId: tabId.optional(),
      slug,
      originalSlug: slug.optional(),
      aliases: z.array(slug).max(MAX_LINK_ALIASES).optional(),
      createOnly: z.boolean().optional(),
      guildId: discordGuildId,
      label: z.string().trim().min(1).max(60),
      visible: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('import_tab'),
      expectedVersion: version,
      spaceId,
      file: z.lazy(() => tabFileSchema),
    })
    .strict(),
  z
    .object({
      action: z.literal('upsert_collection'),
      expectedVersion: version,
      spaceId,
      tabId: tabId.optional(),
      slug,
      originalSlug: slug.optional(),
      label: z.string().trim().max(60).optional(),
      entries: z.array(collectionEntrySchema).min(1).max(MAX_COLLECTION_ITEMS),
      visible: z.boolean().optional(),
      createOnly: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('group_games'),
      expectedVersion: version,
      spaceId,
      slug,
      label: z.string().trim().max(60).optional(),
      slugs: z.array(slug).min(1).max(MAX_COLLECTION_ITEMS),
    })
    .strict(),
  z
    .object({
      action: z.literal('create_profile'),
      handle: z.string().max(64),
      name: z.string().trim().min(1).max(80),
      bio: z.string().trim().max(280).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('rename_space'),
      expectedVersion: version,
      spaceId,
      handle: z.string().max(64),
    })
    .strict(),
  z
    .object({
      action: z.literal('update_profile'),
      expectedVersion: version,
      spaceId,
      name: z.string().trim().min(1).max(80).optional(),
      bio: z.string().trim().max(280).optional(),
      theme: z.enum(themeIds).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('upsert_link'),
      expectedVersion: version,
      spaceId,
      tabId: tabId.optional(),
      slug,
      createOnly: z.boolean().optional(),
      originalSlug: slug.optional(),
      aliases: z.array(slug).max(MAX_LINK_ALIASES).optional(),
      emailSubject: z.string().max(120).optional(),
      emailBody: z.string().max(500).optional(),
      label: z.string().trim().min(1).max(60),
      destination: z.string().trim().min(1).max(2048),
      platform: z.enum(platforms),
      icon: z.enum(iconIds).nullable().optional(),
      visible: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('upsert_project'),
      expectedVersion: version,
      spaceId,
      tabId: tabId.optional(),
      slug,
      createOnly: z.boolean().optional(),
      originalSlug: slug.optional(),
      aliases: z.array(slug).max(MAX_LINK_ALIASES).optional(),
      label: z.string().trim().min(1).max(60),
      description: z.string().trim().min(1).max(800),
      icon: z.enum(iconIds).nullable().optional(),
      coverUrl: z.string().trim().max(2048).nullable().optional(),
      buttons: z.array(itemButtonSchema).min(1).max(MAX_ITEM_BUTTONS),
      visible: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('upsert_interest'),
      expectedVersion: version,
      spaceId,
      tabId: tabId.optional(),
      slug,
      createOnly: z.boolean().optional(),
      originalSlug: slug.optional(),
      aliases: z.array(slug).max(MAX_LINK_ALIASES).optional(),
      interestType: z.enum(interestTypes),
      catalog: z
        .object({
          provider: z.literal('igdb'),
          id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          slug: z
            .string()
            .regex(/^[a-z0-9-]+$/)
            .max(200),
        })
        .strict()
        .nullable()
        .optional(),
      label: z.string().trim().min(1).max(60),
      note: z.string().trim().max(400).optional(),
      coverUrl: z.string().trim().min(1).max(2048).nullable().optional(),
      destination: z.string().trim().min(1).max(2048).nullable().optional(),
      status: z.enum(interestStatuses).nullable().optional(),
      favorite: z.boolean().optional(),
      buttons: z.array(itemButtonSchema).max(MAX_ITEM_BUTTONS).optional(),
      visible: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal('delete_link'), expectedVersion: version, spaceId, slug }).strict(),
  z
    .object({
      action: z.literal('reorder_links'),
      expectedVersion: version,
      spaceId,
      slugs: z.array(slug).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_layout'),
      expectedVersion: version,
      spaceId,
      tabId: tabId.optional(),
      ...layoutFields,
    })
    .strict(),
  z
    .object({
      action: z.literal('set_tabs'),
      expectedVersion: version,
      spaceId,
      defaultTabId: tabId,
      tabs: z
        .array(
          z
            .object({
              id: tabId,
              title: z.string().trim().min(1).max(30),
              hidden: z.boolean().optional(),
              slug: z
                .string()
                .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
                .max(40),
              ...layoutFields,
            })
            .strict(),
        )
        .min(1)
        .max(MAX_PROFILE_TABS),
    })
    .strict(),
  z
    .object({
      action: z.literal('restore_revision'),
      expectedVersion: version,
      spaceId,
      revision: version,
    })
    .strict(),
]);
export type Action = z.infer<typeof actionSchema>;
