import { allItems } from './collections.ts';
import { visibleProfile } from './public-profile.ts';
import { limitMutation, consumeLimit, digestKey } from './abuse-limits.ts';
import { resolveLinkDestination } from './link-redirects.ts';
import { createSpaceStore, spaceConflict, type SpaceChange } from './space-store.ts';
import { actionSchema, type Action } from './profile-action-schema.ts';
import { applyAction } from './profile-actions.ts';
import { AppError } from './app-error.ts';
import { normalizeHandle } from './profile-validation.ts';
import { type LinkItem, type Profile, type ProfileData } from './profile-types.ts';

type CreateAction = Extract<Action, { action: 'create_profile' }>;
type EditAction = Exclude<Action, CreateAction>;

function parseAction(input: unknown): Action {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues.map((issue) => issue.message).join(' '));
  }
  return parsed.data;
}

/** Persist content only; identity, aliases, pictures and version live outside it. */
function profileContent(profile: Profile): ProfileData {
  return {
    name: profile.name,
    bio: profile.bio,
    theme: profile.theme,
    ...(profile.font ? { font: profile.font } : {}),
    ...(profile.pageStyle ? { pageStyle: profile.pageStyle } : {}),
    ...(profile.desktopOrder ? { desktopOrder: profile.desktopOrder } : {}),
    ...(profile.documents ? { documents: profile.documents } : {}),
    links: profile.links,
    ...(profile.tabs ? { tabs: profile.tabs, defaultTabId: profile.defaultTabId } : {}),
    ...(profile.sections ? { sections: profile.sections } : {}),
    ...(profile.ungroupedPosition ? { ungroupedPosition: profile.ungroupedPosition } : {}),
  };
}

/** Select only newly imported or explicitly edited destinations for loop checks. */
function changedItems(action: EditAction, current: Profile, proposed: Profile): LinkItem[] {
  switch (action.action) {
    case 'publish_document':
      return proposed.links;
    case 'import_tab':
    case 'paste_content':
      return proposed.links.filter((item) => !current.links.some((old) => old.id === item.id));
    case 'upsert_link':
    case 'upsert_project':
    case 'upsert_interest':
    case 'upsert_discord':
    case 'upsert_collection': {
      const item = proposed.links.find((item) => item.slug === action.slug);
      return item ? [item] : [];
    }
    default:
      return [];
  }
}

/** Shared application boundary for HTTP and MCP; neither transport owns rules. */
export function createSpaceService(db: D1Database, clock: () => number = Date.now) {
  const store = createSpaceStore(db);

  async function getPublicProfile(
    handle: string,
    includeDocuments = true,
  ): Promise<Profile | null> {
    const profile = await store.findByHandle(handle);
    if (!profile) return null;
    // Redirect lookup uses the persisted projection without parsing document source.
    if (!includeDocuments) delete profile.documents;
    return visibleProfile(profile);
  }

  async function checkHandle(userId: string, value: string, spaceId?: string) {
    if (spaceId) await store.getAccount(userId, spaceId);
    const handle = normalizeHandle(value);
    const owner = await store.findHandleOwner(handle);
    return { handle, available: !owner || owner.id === spaceId };
  }

  async function createSpace(userId: string, action: CreateAction, now: string) {
    const handle = normalizeHandle(action.handle);
    const data: ProfileData = {
      name: action.name,
      bio: action.bio ?? '',
      theme: 'lilac',
      links: [],
    };
    return store.insertSpace(userId, handle, data, now);
  }

  async function prepareChange(
    userId: string,
    current: Profile,
    content: ProfileData,
    action: EditAction,
  ): Promise<SpaceChange | null> {
    switch (action.action) {
      case 'rename_space': {
        const handle = normalizeHandle(action.handle);
        if (handle === current.handle) return null;
        await consumeLimit(db, `rename-day:${await digestKey(userId)}`, 10, 86_400_000, clock());
        return {
          handle,
          data: content,
          reason: `Changed username from @${current.handle} to @${handle}`,
        };
      }
      case 'restore_revision':
        return {
          handle: current.handle,
          data: await store.getRevision(current.id, action.revision),
          reason: `Restored revision ${action.revision}`,
        };
      default:
        return { handle: current.handle, ...applyAction(content, action) };
    }
  }

  async function validateDestinations(current: Profile, data: ProfileData, action: EditAction) {
    const proposed = { ...current, ...data };
    const changed = changedItems(action, current, proposed);
    // Filter parents before flattening: hidden collections hide their children.
    const visibleItems = allItems(changed.filter((item) => item.visible)).filter(
      (item) => item.visible,
    );
    if (!visibleItems.length) return;

    async function resolveProfile(handle: string) {
      if (handle === current.handle || current.aliases.includes(handle)) return proposed;
      const found = await getPublicProfile(handle, false);
      return found?.id === current.id ? proposed : found;
    }

    try {
      for (const item of visibleItems) {
        await resolveLinkDestination(proposed, item.slug, resolveProfile, {
          allowUnavailable: true,
        });
      }
    } catch (error) {
      // A loop is invalid user input when saving, rather than a redirect failure.
      if (error instanceof AppError && error.status === 508) throw new AppError(error.message);
      throw error;
    }
  }

  async function mutate(userId: string, input: unknown): Promise<Profile> {
    const action = parseAction(input);
    await limitMutation(db, userId, clock());
    const now = new Date().toISOString();

    if (action.action === 'create_profile') return createSpace(userId, action, now);

    const current = await store.getAccount(userId, action.spaceId);
    if (!current) throw new AppError('Create your first space.', 404);
    if (action.expectedVersion !== current.version) throw spaceConflict();

    const content = profileContent(current);
    const change = await prepareChange(userId, current, content, action);
    if (!change) return current;
    await validateDestinations(current, change.data, action);

    const unchanged =
      change.handle === current.handle && JSON.stringify(change.data) === JSON.stringify(content);
    if (unchanged) return current;

    return store.saveChange(userId, current, change, now);
  }

  return {
    listSpaces: store.listSpaces,
    getAccount: store.getAccount,
    getPublicProfile,
    getHistory: store.getHistory,
    checkHandle,
    mutate,
  };
}
