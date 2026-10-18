import { z } from 'zod';
import type { LinkItem } from './profile-types.ts';
import { itemButtonSchema } from './item-buttons.ts';

export const MAX_COLLECTION_ITEMS = 20;
export type CollectionContent = { type: 'game'; items: LinkItem[] };
const buttons = z.array(itemButtonSchema).max(3).optional();
export const collectionEntrySchema = z.union([
  z.object({ id: z.string().min(1).max(100), visible: z.boolean().optional(), buttons }).strict(),
  z
    .object({
      game: z
        .object({
          title: z.string().trim().min(1).max(60),
          coverUrl: z.string().max(2048).optional(),
          source: z
            .object({
              provider: z.literal('igdb'),
              id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
              slug: z
                .string()
                .regex(/^[a-z0-9-]+$/)
                .max(200),
            })
            .strict(),
        })
        .strict(),
      buttons,
    })
    .strict(),
]);
export type CollectionEntry = z.infer<typeof collectionEntrySchema>;
