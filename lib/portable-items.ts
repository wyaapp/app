import { z } from 'zod';
import { AppError } from './app-error.ts';
import { normalizeDestination } from './profile-validation.ts';
import { MAX_PROJECTS, type LinkItem, type ProfileData } from './profile-types.ts';
import { platforms, iconIds } from './link-options.ts';
import { interestTypes, interestStatuses } from './interests.ts';
import { allItems } from './collections.ts';
import { discordConfigSchema } from './discord-widget-types.ts';

const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/);
const webUrl = z
  .string()
  .max(2048)
  .transform((value, ctx) => {
    try {
      return normalizeDestination('website', value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Use an HTTP or HTTPS URL without credentials.' });
      return z.NEVER;
    }
  });
const coverUrl = webUrl.refine(
  (value) => value.startsWith('https://'),
  'Cover images must use HTTPS.',
);
const buttons = z
  .array(z.object({ label: z.string().trim().min(1).max(30), url: webUrl }).strict())
  .max(3);
const common = {
  slug,
  aliases: z.array(slug).max(10).optional(),
  label: z.string().trim().max(60),
  visible: z.boolean(),
  icon: z.enum(iconIds).optional(),
};
const gameSchema = z
  .object({
    ...common,
    kind: z.literal('interest'),
    label: common.label.min(1),
    platform: z.literal('website'),
    url: z.union([z.literal(''), webUrl]),
    interest: z
      .object({
        type: z.enum(interestTypes),
        note: z.string().max(400),
        favorite: z.boolean(),
        coverUrl: coverUrl.optional(),
        status: z.enum(interestStatuses).optional(),
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
          .optional(),
        buttons: buttons.optional(),
      })
      .strict(),
  })
  .strict();
const itemSchema = z.union([
  z
    .object({
      ...common,
      kind: z.literal('discord'),
      label: common.label.min(1),
      platform: z.literal('discord'),
      url: z.literal(''),
      discord: discordConfigSchema,
    })
    .strict(),
  z
    .object({
      ...common,
      label: common.label.min(1),
      platform: z.enum(platforms),
      url: z.string().min(1).max(2048),
    })
    .strict()
    .transform((item, ctx) => {
      try {
        return { ...item, url: normalizeDestination(item.platform, item.url) };
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid link destination.' });
        return z.NEVER;
      }
    }),
  z
    .object({
      ...common,
      kind: z.literal('project'),
      label: common.label.min(1),
      platform: z.literal('portfolio'),
      url: webUrl,
      project: z
        .object({
          description: z.string().trim().min(1).max(800),
          coverUrl: coverUrl.optional(),
          buttons: buttons.min(1),
        })
        .strict(),
    })
    .strict()
    .refine(
      (item) => item.url === item.project.buttons[0].url,
      'Project destination must match its first button.',
    ),
  gameSchema.refine(
    (item) => !item.interest.buttons?.length || item.url === item.interest.buttons[0].url,
    'Game destination must match its first button.',
  ),
  z
    .object({
      ...common,
      kind: z.literal('collection'),
      platform: z.literal('website'),
      url: z.literal(''),
      collection: z
        .object({ type: z.literal('game'), items: z.array(gameSchema).min(1).max(20) })
        .strict(),
    })
    .strict(),
]);
export const portableItemsSchema = z
  .array(itemSchema)
  .max(100)
  .superRefine((values, ctx) => {
    const items = allItems(values as LinkItem[]);
    const names = items.flatMap((item) => [item.slug, ...(item.aliases ?? [])]);
    if (items.length > 100 || new Set(names).size !== names.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Use up to 100 items with unique slugs and aliases.',
      });
    for (const item of values)
      if ('collection' in item) {
        const refs = item.collection.items.flatMap((game) =>
          game.interest.catalog ? [game.interest.catalog.id] : [],
        );
        if (new Set(refs).size !== refs.length)
          ctx.addIssue({
            code: 'custom',
            message: 'A collection cannot contain the same catalog game twice.',
          });
        if (
          item.collection.items.some(
            (game) => game.interest.buttons?.length && game.url !== game.interest.buttons[0].url,
          )
        )
          ctx.addIssue({
            code: 'custom',
            message: 'Game destination must match its first button.',
          });
      }
  });

export function portableItem(item: LinkItem): unknown {
  return {
    slug: item.slug,
    label: item.label,
    url: item.url,
    platform: item.platform,
    visible: item.visible,
    ...(item.aliases ? { aliases: item.aliases } : {}),
    ...(item.icon ? { icon: item.icon } : {}),
    ...(item.kind ? { kind: item.kind } : {}),
    ...(item.discord ? { discord: item.discord } : {}),
    ...(item.project ? { project: item.project } : {}),
    ...(item.interest ? { interest: item.interest } : {}),
    ...(item.collection
      ? {
          collection: {
            type: item.collection.type,
            items: item.collection.items.map(portableItem),
          },
        }
      : {}),
  };
}
export function allocate(name: string, taken: Set<string>, reserve = taken) {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  let candidate = name;
  for (let i = 2; taken.has(candidate) || reserve.has(candidate); i++) {
    const suffix = `-${i}`;
    candidate = name.slice(0, 40 - suffix.length).replace(/[._-]+$/, '') + suffix;
  }
  taken.add(candidate);
  reserve.add(candidate);
  return candidate;
}

export function copyPortableItems(data: ProfileData, incomingItems: LinkItem[]) {
  if (allItems(data.links).length + allItems(incomingItems as LinkItem[]).length > 100)
    throw new AppError(
      'Import would exceed 100 items per space, including games inside collections.',
    );
  if (
    [...data.links, ...incomingItems].filter((item) => 'kind' in item && item.kind === 'project')
      .length > MAX_PROJECTS
  )
    throw new AppError('Import would exceed 12 projects per space.');
  const used = new Set(
    allItems(data.links).flatMap((item) => [item.slug, ...(item.aliases ?? [])]),
  );
  const incoming = allItems(incomingItems as LinkItem[]).flatMap((item) => [
    item.slug,
    ...(item.aliases ?? []),
  ]);
  const reserved = new Set([...used, ...incoming]);
  const renames: { from: string; to: string }[] = [],
    mapping = new Map<string, string>();
  for (const name of incoming) {
    const next = allocate(name, used, reserved);
    mapping.set(name, next);
    if (name !== next) renames.push({ from: name, to: next });
  }
  const items = structuredClone(incomingItems) as LinkItem[];
  for (const item of allItems(items)) {
    item.id = crypto.randomUUID();
    item.slug = mapping.get(item.slug)!;
    if (item.aliases) item.aliases = item.aliases.map((alias) => mapping.get(alias)!);
  }
  return { items, mapping, renames };
}
