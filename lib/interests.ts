import type { ItemButton } from './item-buttons.ts';
import type { CatalogReference } from './catalog-types.ts';
import type { LinkIconId } from './link-options.ts';
import { suggestItemSlug } from './item-slug.ts';
// Add media-specific labels here as new interest types are introduced. The
// stored fields, editor, layout membership, and card are shared across types.
export const interestTypes = ['game'] as const;
export type InterestType = (typeof interestTypes)[number];
export const interestStatuses = ['active', 'planned', 'completed', 'paused', 'dropped'] as const;
export type InterestStatus = (typeof interestStatuses)[number];
export type InterestContent = {
  type: InterestType;
  note: string;
  coverUrl?: string;
  status?: InterestStatus;
  favorite: boolean;
  catalog?: CatalogReference;
  buttons?: ItemButton[];
};

export const interestDefinitions: Record<
  InterestType,
  {
    label: string;
    plural: string;
    titleLabel: string;
    notePlaceholder: string;
    icon: LinkIconId;
    statuses: Record<InterestStatus, string>;
  }
> = {
  game: {
    icon: 'gamepad',
    label: 'Game',
    plural: 'Games',
    titleLabel: 'Game title',
    notePlaceholder: 'What makes this game special to you?',
    statuses: {
      active: 'Playing',
      planned: 'Want to play',
      completed: 'Played',
      paused: 'On hold',
      dropped: 'Stopped playing',
    },
  },
};

export function suggestInterestSlug(
  title: string,
  existingSlugs: string[],
  type: InterestType,
): string {
  return suggestItemSlug(title, existingSlugs, type);
}
