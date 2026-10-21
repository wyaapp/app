import { socialUsernamePlatforms } from './social-links';
import { z } from 'zod';
import { collectionEntrySchema, MAX_COLLECTION_ITEMS } from './collection-types';
import { interestTypes, interestStatuses } from './interests';
import { platforms, iconIds, linkPresets } from './link-options';
import { themeIds } from './profile-themes';

// Discovery descriptions and schemas are separate from transport/authentication.
const string = { type: 'string' };
const bio = {
  type: 'string',
  maxLength: 280,
  description:
    'Plain-text bio. Clickable mentions: @handle for Wya; github:username, instagram:username, linkedin:username, youtube:username, tiktok:username, x:username, bluesky:handle.bsky.social, telegram:username, twitch:username. Full HTTP(S) URLs also become links. No HTML or Markdown required. Mentions do not notify or verify the mentioned account.',
};
const spaceId = {
  type: 'string',
  description:
    'Stable space ID from list_spaces or get_profile. Required whenever the account has multiple spaces. Ask which space if unclear; never guess.',
};
const tabId = {
  type: 'string',
  description:
    'Stable profile tab ID from get_profile layout. Omit on item edits to retain placement; new items default to the default tab.',
};
const layoutFields = {
  ungroupedPosition: { type: 'integer', minimum: 0, maximum: 20 },
  ungrouped: { type: 'array', items: string, maxItems: 100 },
  sections: {
    type: 'array',
    maxItems: 20,
    items: {
      type: 'object',
      properties: {
        id: string,
        title: { type: 'string', minLength: 1, maxLength: 60 },
        slugs: { type: 'array', items: string, maxItems: 100 },
      },
      required: ['id', 'title', 'slugs'],
      additionalProperties: false,
    },
  },
};
export const readTools = new Set(['get_profile', 'list_spaces', 'search_catalog']);
const expectedVersion = {
  type: 'integer',
  minimum: 1,
  description:
    'The version returned by get_profile. Read the current profile before making a change.',
};
const definition = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  destructive = false,
) => ({
  name,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: {
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: false,
    openWorldHint: false,
  },
});
export const tools = [
  definition(
    'upsert_discord',
    'Add or edit a Discord server widget. Supply its numeric server ID as guildId and a display label. The server owner must enable Server Widget in Discord; no bot token or webhook is needed. Wya fetches public member presence and voice channels with a 15-minute cache. Only configuration is stored in profile history. No chat messages are exposed. New widgets are hidden unless visible:true is requested. Omitted visibility and aliases preserve current values. Use createOnly for new entries and originalSlug to rename. Shared tabs, layout, limits, deletion and revision rules apply.',
    {
      spaceId,
      expectedVersion,
      tabId,
      slug: string,
      originalSlug: string,
      guildId: { type: 'string', pattern: '^[1-9][0-9]{16,19}$' },
      label: { type: 'string', minLength: 1, maxLength: 60 },
      visible: { type: 'boolean' },
      createOnly: { type: 'boolean' },
      aliases: { type: 'array', items: string, maxItems: 10 },
    },
    ['expectedVersion', 'slug', 'guildId', 'label'],
  ),
  definition(
    'upsert_collection',
    'Create or replace a Game Collection containing 1–20 games. label is an optional section heading; omit it to preserve an existing title, or pass an empty string to remove the heading. New collections can be untitled. Search the catalog first. For a new game pass {game:{title,source,coverUrl?},buttons?}; source comes from search_catalog. For an existing child pass {id,buttons?,visible?} using its ID from get_profile; omitted buttons and visibility are preserved. entries is the complete ordered list: omitted children are removed and their short URLs stop working. New games start without buttons; their cover links to the catalog page. Add buttons only when requested. [] removes buttons and clears the destination. New widgets are hidden unless visible:true is explicitly requested. To rename a collection URL, pass its current slug as originalSlug and the new value as slug. This retires the old collection URL; child IDs, URLs and layout placement are preserved. Child URLs, aliases and metadata survive edits by ID. Use group_games to convert existing standalone games; do not recreate them. Widgets cannot contain widgets. The 100-item space limit includes widgets and their children. Requires a fresh expectedVersion.',
    {
      spaceId,
      expectedVersion,
      tabId,
      slug: string,
      originalSlug: string,
      label: { type: 'string', maxLength: 60 },
      visible: { type: 'boolean' },
      createOnly: { type: 'boolean' },
      entries: z.toJSONSchema(z.array(collectionEntrySchema).min(1).max(MAX_COLLECTION_ITEMS)),
    },
    ['expectedVersion', 'slug', 'entries'],
    true,
  ),
  definition(
    'group_games',
    "Explicitly group 1–20 existing individual games from the same tab and section into a Game Collection at the first selected game's position. Preserve children's IDs, short URLs, aliases, buttons, visibility and catalog snapshots. Pass a new unused widget slug and optional section title in label. This moves entries; request the user's intent before grouping. No automatic migration occurs.",
    {
      spaceId,
      expectedVersion,
      slug: string,
      label: { type: 'string', maxLength: 60 },
      slugs: { type: 'array', items: string, minItems: 1, maxItems: MAX_COLLECTION_ITEMS },
    },
    ['expectedVersion', 'slug', 'slugs'],
  ),
  {
    name: 'search_catalog',
    description:
      'Search the game catalog by title before adding a game. Returns candidate titles, covers, platforms, release years and catalog references. Ask which result if ambiguous. Search does not save or publish anything. Currently supports type game; never invent catalog IDs or artwork URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: interestTypes },
        query: { type: 'string', minLength: 2, maxLength: 80 },
      },
      required: ['type', 'query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  definition(
    'upsert_interest',
    'Create or edit a standalone Game widget. Use upsert_collection when the user wants a Game Collection grid instead. Use search_catalog first and pass its source as catalog, title as label and coverUrl. Currently interestType is game. Optional buttons: up to 3 {label,destination} HTTP(S) links, like project buttons. Omitted buttons are preserved; [] removes them. The first button determines the short URL destination, so omit destination when buttons are present. Removing all buttons clears the old button destination unless destination is supplied. Personal fields: note (400 chars), status (active=Playing, planned=Want to play, completed=Played, paused=On hold, dropped=Stopped playing), favorite. destination is an optional HTTP(S) link; without one the tile is not clickable and its short URL opens the item on the profile. Optional coverUrl must use HTTPS. Omitted fields preserve previous values; null clears coverUrl, destination, status or catalog. New items start hidden: set visible:true only when asked to publish. Shared 100-item limit, aliases, tabId, createOnly, originalSlug, set_tabs, delete_link and history rules apply. Do not change another item type into an interest. Catalog data is a saved snapshot, not live activity.',
    {
      spaceId,
      expectedVersion,
      tabId,
      interestType: { type: 'string', enum: interestTypes },
      slug: string,
      originalSlug: string,
      createOnly: { type: 'boolean' },
      aliases: { type: 'array', items: string, maxItems: 10 },
      label: { type: 'string', maxLength: 60 },
      note: { type: 'string', maxLength: 400 },
      coverUrl: { type: ['string', 'null'], maxLength: 2048 },
      destination: { type: ['string', 'null'], maxLength: 2048 },
      status: { type: ['string', 'null'], enum: [...interestStatuses, null] },
      favorite: { type: 'boolean' },
      buttons: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 30 },
            destination: { type: 'string', minLength: 1, maxLength: 2048 },
          },
          required: ['label', 'destination'],
          additionalProperties: false,
        },
      },
      visible: { type: 'boolean' },
      catalog: {
        type: ['object', 'null'],
        properties: {
          provider: { type: 'string', enum: ['igdb'] },
          id: { type: 'integer', minimum: 1 },
          slug: { type: 'string', maxLength: 200, pattern: '^[a-z0-9-]+$' },
        },
        required: ['provider', 'id', 'slug'],
        additionalProperties: false,
      },
    },
    ['expectedVersion', 'interestType', 'slug', 'label'],
  ),
  definition(
    'remove_profile_picture',
    'Remove the picture from the selected space and show initials instead. Pictures have no history and cannot be restored. Requires an explicit space ID.',
    { spaceId, expectedVersion },
    ['spaceId', 'expectedVersion'],
    true,
  ),
  definition(
    'copy_profile_picture',
    "Copy the current picture from one of the signed-in account's spaces to another. Both spaces must belong to this account. Replaces the destination picture without photo history. To upload a new picture, direct the user to pictureEditorUrl returned by get_profile; do not claim to transfer conversation attachments.",
    {
      spaceId,
      sourceSpaceId: {
        type: 'string',
        description: 'Stable ID of the owned space to copy the picture from.',
      },
      expectedVersion,
    },
    ['spaceId', 'sourceSpaceId', 'expectedVersion'],
    true,
  ),
  {
    name: 'get_profile',
    description:
      "Read the authenticated user's wya.im profile, links (including projects, game interests, and collection widgets with nested games, stable item IDs and aliases), current version, and recent revisions. Pass spaceId from list_spaces. With multiple spaces, ask the user which space if unclear. Never accepts an owner ID; always uses the signed-in account.",
    inputSchema: { type: 'object', properties: { spaceId }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'list_spaces',
    description:
      "List the signed-in account's spaces (up to five), including stable IDs, usernames, names, themes, and versions. Use this to choose a space before reading or editing. Ask the user when the target is ambiguous.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  definition(
    'rename_space',
    "Change a space's username. The new username must not be currently used by another space. Previous usernames are available immediately. Only the immediately previous username redirects profiles and short links here, until someone claims it or this space renames again. Mention this consequence when proposing a rename. This does not change its stable ID or count as another space. Use the exact new username the user requested.",
    { spaceId, expectedVersion, handle: string },
    ['expectedVersion', 'handle'],
  ),
  definition(
    'create_profile',
    'Create a new independent space for the signed-in user, up to five per account. Ask for the desired username and display name. Existing profiles become the first space. Use rename_space to change an existing username.',
    { handle: string, name: string, bio },
    ['handle', 'name'],
  ),
  definition(
    'update_profile',
    "Change the signed-in user's display name, bio, or color theme. Omitted fields are preserved.",
    { spaceId, expectedVersion, name: string, bio, theme: { type: 'string', enum: themeIds } },
    ['expectedVersion'],
  ),
  definition(
    'upsert_link',
    `Add or update a link. label is its display name; slug is its primary short URL. Social presets with recognizable profile handles accept usernames or URLs (${socialUsernamePlatforms.map((platform) => linkPresets[platform].label).join(', ')}). Use the full domain handle for Bluesky; Mastodon and Pixelfed require @user@server or a profile URL. Steam accepts a custom profile URL name, not the private login name. The username is displayed automatically below the label; do not append it to the label. The email preset accepts one address or mailto URL, plus optional emailSubject (120 chars) and emailBody (500 chars); other presets require HTTP(S). aliases supplies up to 10 extra slugs pointing to this same item; omitted preserves them, [] clears them. Aliases must be unique across all items and different from the main slug. Pass originalSlug to rename; existing aliases stay attached. Include the old slug in aliases if it should keep working. Set createOnly for new items to prevent overwriting an existing slug. Hidden links and aliases are disabled. Internal redirect cycles are rejected. Use upsert_project for project cards. Omit icon to preserve it, or null for the preset default.`,
    {
      spaceId,
      expectedVersion,
      tabId,
      slug: string,
      originalSlug: string,
      createOnly: { type: 'boolean' },
      aliases: { type: 'array', items: string, maxItems: 10 },
      label: string,
      destination: string,
      emailSubject: { type: 'string', maxLength: 120 },
      emailBody: { type: 'string', maxLength: 500 },
      platform: { type: 'string', enum: platforms },
      icon: { type: ['string', 'null'], enum: [...iconIds, null] },
      visible: { type: 'boolean', default: true },
    },
    ['expectedVersion', 'slug', 'label', 'destination', 'platform'],
  ),
  definition(
    'upsert_project',
    "Create or edit a project card in this space. Up to 12 projects, within the 100-item limit. Supply title in label (60 chars), description (800 chars), and 1–3 buttons with labels (30 chars) and HTTP(S) destinations. The first button is the short URL destination. coverUrl is an optional hosted HTTPS image: omitted preserves it; null removes it. Covers load in visitors' browsers; no image upload or URL import is performed. New projects default to hidden: set visible:true only when publication is requested; omitting visible preserves current visibility when editing. Reuse originalSlug when renaming and createOnly:true for new cards. aliases behave exactly as for links. icon chooses from the shared icon library; omit to preserve it, or null for the default folder. It appears when there is no cover or the cover fails to load. Projects use the shared set_layout, delete_link and history actions; link and project types cannot overwrite one another.",
    {
      spaceId,
      expectedVersion,
      tabId,
      slug: string,
      originalSlug: string,
      createOnly: { type: 'boolean' },
      aliases: { type: 'array', items: string, maxItems: 10 },
      label: { type: 'string', maxLength: 60 },
      description: { type: 'string', maxLength: 800 },
      icon: { type: ['string', 'null'], enum: [...iconIds, null] },
      coverUrl: { type: ['string', 'null'], maxLength: 2048 },
      buttons: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          properties: { label: { type: 'string', maxLength: 30 }, destination: string },
          required: ['label', 'destination'],
          additionalProperties: false,
        },
      },
      visible: { type: 'boolean' },
    },
    ['expectedVersion', 'slug', 'label', 'description', 'buttons'],
  ),
  definition(
    'delete_link',
    "Remove a link, project or interest tile from the signed-in user's profile and disable its short URL and aliases. The previous state remains in history.",
    { spaceId, expectedVersion, slug: string },
    ['expectedVersion', 'slug'],
    true,
  ),
  definition(
    'set_tabs',
    'Create, rename, reorder or remove optional profile tabs and organize all sections/items in one revision. Read get_profile.layout first. Supply 1–5 tabs with stable IDs (letters/numbers/underscores/hyphens, 1–64 chars), unique URL slugs (lowercase letters/numbers joined by hyphens, max 40), titles (1–30 chars), and defaultTabId. Each tab has ungrouped, sections and optional ungroupedPosition (defaults to 0). Optional hidden:true hides the tab, its contents and their short URLs; false restores visibility. Omission preserves the saved setting. A hidden default falls back to the first visible tab publicly; all hidden tabs show an empty profile. There may be at most 20 sections across the space, with globally unique section IDs and titles of 1–60 chars. Include EVERY existing item primary slug exactly once across all tabs, including hidden links/projects/interests. Removing a tab must move its items elsewhere; it never deletes items. Changing a tab URL slug changes shared ?tab= URLs. One tab hides navigation publicly; short URLs and aliases remain shared across the space.',
    {
      spaceId,
      expectedVersion,
      defaultTabId: string,
      tabs: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            id: string,
            title: { type: 'string', minLength: 1, maxLength: 30 },
            hidden: {
              type: 'boolean',
              description:
                'Hide this tab and all its contents, including short URLs. Omit to preserve the current setting.',
            },
            slug: { type: 'string', maxLength: 40, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
            ...layoutFields,
          },
          required: ['id', 'title', 'slug', 'ungrouped', 'sections'],
          additionalProperties: false,
        },
      },
    },
    ['expectedVersion', 'defaultTabId', 'tabs'],
  ),
  definition(
    'set_layout',
    'Organize sections and items within one existing tab. tabId is required when the profile has multiple tabs. Include every item in that tab exactly once, including hidden items, using primary slugs, in ungrouped or a section. Section IDs must be globally unique within the space; at most 20 sections total. ungroupedPosition is 0 through the number of sections; omit to preserve position. Use set_tabs to create/remove tabs or move content across tabs. Read get_profile first.',
    { spaceId, expectedVersion, tabId, ...layoutFields },
    ['expectedVersion', 'ungrouped', 'sections'],
  ),
  definition(
    'reorder_links',
    "Reorder all the signed-in user's links. Include every slug exactly once, including hidden links. Section membership and section order are preserved; use set_layout to change them.",
    { spaceId, expectedVersion, slugs: { type: 'array', items: string } },
    ['expectedVersion', 'slugs'],
  ),
  definition(
    'restore_revision',
    "Restore the signed-in user's profile and links to a prior revision from get_profile. Replaces current name, bio, theme, and links, while preserving the handle and current picture. Pictures are not included in revision history. The current state is also saved to history.",
    { spaceId, expectedVersion, revision: { type: 'integer', minimum: 1 } },
    ['expectedVersion', 'revision'],
    true,
  ),
];
