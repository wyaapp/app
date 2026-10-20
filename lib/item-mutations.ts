import { AppError } from './app-error.ts';
import { MAX_PROJECTS, type LinkItem, type ProfileData } from './profile-types.ts';
import type { Action } from './profile-action-schema.ts';
import { normalizeDestination } from './profile-validation.ts';
import { emailLink } from './email-links.ts';
import { interestDefinitions } from './interests.ts';
import { allItems } from './collections.ts';
import {
  getProfileLayout,
  reconcileProfileLayout,
  moveItemToTab,
  applyProfileLayout,
} from './profile-tabs.ts';

type ItemAction = Extract<
  Action,
  { action: 'upsert_link' | 'upsert_project' | 'upsert_interest' | 'upsert_discord' }
>;

// Mutates the working copy owned by applyAction; the caller's profile stays untouched.
export function upsertItem(
  next: ProfileData,
  action: ItemAction,
): { data: ProfileData; reason: string } {
  if (
    action.tabId !== undefined &&
    !getProfileLayout(next).tabs.some((tab) => tab.id === action.tabId)
  )
    throw new AppError('Tab not found.', 404);
  const index = next.links.findIndex((link) => link.slug === (action.originalSlug ?? action.slug));
  const previous = next.links[index];
  if (action.createOnly && previous)
    throw new AppError('That URL slug is already used. Choose a different slug.');
  if (action.originalSlug !== undefined && !previous)
    throw new AppError('Link not found. Reload this space before editing it.', 404);
  const expectedKind =
    action.action === 'upsert_project'
      ? 'project'
      : action.action === 'upsert_interest'
        ? 'interest'
        : action.action === 'upsert_discord'
          ? 'discord'
          : undefined;
  if (previous && previous.kind !== expectedKind)
    throw new AppError(
      previous.kind === 'project'
        ? 'Use the project editor to edit this item.'
        : !previous.kind
          ? 'That slug belongs to a link. Choose a different slug.'
          : previous.kind === 'interest'
            ? 'Use the interest editor to edit this item.'
            : 'Use the matching editor to edit this item.',
    );
  if (
    action.action === 'upsert_interest' &&
    previous?.interest &&
    previous.interest.type !== action.interestType
  )
    throw new AppError('Use the existing interest type when editing this item.');
  const aliases = action.aliases ?? previous?.aliases ?? [];
  const names = [action.slug, ...aliases];
  if (new Set(names).size !== names.length)
    throw new AppError('Aliases must be unique and different from the main URL slug.');
  if (
    allItems(next.links.filter((_, i) => i !== index)).some((link) =>
      [link.slug, ...(link.aliases ?? [])].some((name) => names.includes(name)),
    )
  )
    throw new AppError(
      'That URL slug or alias is already used by another item. Choose a different slug.',
    );
  const link =
    action.action === 'upsert_interest'
      ? buildInterest(action, previous)
      : action.action === 'upsert_project'
        ? buildProject(action, previous, next)
        : action.action === 'upsert_discord'
          ? buildDiscord(action, previous)
          : buildLink(action, previous);
  // Legacy items acquire a deterministic ID on first edit; it survives renames.
  link.id = previous?.id ?? (previous ? `legacy:${previous.slug}` : crypto.randomUUID());
  if (aliases.length) link.aliases = aliases;
  if (previous?.sectionId) link.sectionId = previous.sectionId;
  if (index < 0) {
    if (allItems(next.links).length >= 100)
      throw new AppError('You can have up to 100 items per space.');
    next.links.push(link);
  } else next.links[index] = link;
  const renamed = previous && previous.slug !== action.slug;
  if (next.tabs) {
    let layout = reconcileProfileLayout(
      { tabs: next.tabs, defaultTabId: next.defaultTabId! },
      next,
      renamed ? { from: previous.slug, to: action.slug } : undefined,
    );
    const target = layout.tabs.find((tab) => tab.id === action.tabId);
    if (
      target &&
      ![...target.ungrouped, ...target.sections.flatMap((section) => section.slugs)].includes(
        action.slug,
      )
    )
      layout = moveItemToTab(layout, action.slug, target.id);
    Object.assign(next, applyProfileLayout(next, layout));
  }
  return {
    data: next,
    reason: renamed
      ? `Changed /${previous.slug} to /${action.slug}`
      : `${index < 0 ? 'Added' : 'Updated'} /${action.slug}`,
  };
}

function buildDiscord(
  action: Extract<ItemAction, { action: 'upsert_discord' }>,
  previous?: LinkItem,
): LinkItem {
  return {
    kind: 'discord',
    discord: { guildId: action.guildId },
    platform: 'discord',
    slug: action.slug,
    label: action.label,
    url: '',
    visible: action.visible ?? previous?.visible ?? false,
  };
}

function buildInterest(
  action: Extract<ItemAction, { action: 'upsert_interest' }>,
  previous: LinkItem | undefined,
): LinkItem {
  const cover = action.coverUrl === undefined ? previous?.interest?.coverUrl : action.coverUrl;
  const coverUrl = cover ? normalizeDestination('website', cover) : undefined;
  if (coverUrl && !coverUrl.startsWith('https://'))
    throw new AppError('Use an HTTPS image URL for the cover.');
  const buttons =
    action.buttons === undefined
      ? previous?.interest?.buttons
      : action.buttons.map((button) => ({
          label: button.label,
          url: normalizeDestination('website', button.destination),
        }));
  if (
    buttons?.length &&
    action.destination !== undefined &&
    action.destination !== null &&
    normalizeDestination('website', action.destination) !== buttons[0].url
  )
    throw new AppError('The destination must match the first button, or be omitted.');
  const destination = buttons?.length
    ? buttons[0].url
    : action.destination !== undefined
      ? action.destination
      : action.buttons !== undefined && previous?.interest?.buttons?.length
        ? ''
        : previous?.url;
  const status = action.status === undefined ? previous?.interest?.status : action.status;
  const catalog = action.catalog === undefined ? previous?.interest?.catalog : action.catalog;
  const link: LinkItem = {
    slug: action.slug,
    label: action.label,
    url: destination ? normalizeDestination('website', destination) : '',
    platform: 'website',
    icon: interestDefinitions[action.interestType].icon,
    visible: action.visible ?? previous?.visible ?? false,
    kind: 'interest',
    interest: {
      type: action.interestType,
      note: action.note ?? previous?.interest?.note ?? '',
      favorite: action.favorite ?? previous?.interest?.favorite ?? false,
      ...(coverUrl ? { coverUrl } : {}),
      ...(status ? { status } : {}),
      ...(catalog ? { catalog } : {}),
      ...(buttons !== undefined ? { buttons } : {}),
    },
  };

  return link;
}

function buildProject(
  action: Extract<ItemAction, { action: 'upsert_project' }>,
  previous: LinkItem | undefined,
  next: ProfileData,
): LinkItem {
  if (!previous && next.links.filter((link) => link.kind === 'project').length >= MAX_PROJECTS)
    throw new AppError(`You can have up to ${MAX_PROJECTS} projects per space.`);
  const buttons = action.buttons.map((button) => ({
    label: button.label,
    url: normalizeDestination('website', button.destination),
  }));
  const cover = action.coverUrl === undefined ? previous?.project?.coverUrl : action.coverUrl;
  const coverUrl = cover ? normalizeDestination('website', cover) : undefined;
  if (coverUrl && !coverUrl.startsWith('https://'))
    throw new AppError('Use an HTTPS image URL for the project cover.');
  const link: LinkItem = {
    slug: action.slug,
    label: action.label,
    url: buttons[0].url,
    platform: 'portfolio',
    visible: action.visible ?? previous?.visible ?? false,
    kind: 'project',
    project: { description: action.description, buttons, ...(coverUrl ? { coverUrl } : {}) },
  };
  const icon = action.icon === undefined ? previous?.icon : action.icon;
  if (icon) link.icon = icon;

  return link;
}

function buildLink(
  action: Extract<ItemAction, { action: 'upsert_link' }>,
  previous: LinkItem | undefined,
): LinkItem {
  if (
    action.platform !== 'email' &&
    (action.emailSubject !== undefined || action.emailBody !== undefined)
  )
    throw new AppError('Subject and message are only available for email links.');
  let url = normalizeDestination(action.platform, action.destination);
  if (action.platform === 'email') {
    try {
      url = emailLink(action.destination, action.emailSubject, action.emailBody);
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : 'Invalid email link.');
    }
  }
  const link: LinkItem = {
    slug: action.slug,
    label: action.label,
    url,
    platform: action.platform,
    visible: action.visible,
  };
  const icon = action.icon === undefined ? previous?.icon : action.icon;
  if (icon) link.icon = icon;

  return link;
}
