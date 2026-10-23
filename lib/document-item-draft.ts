import { AppError } from './app-error.ts';
import { allItems } from './collections.ts';
import { getLayoutGroups } from './link-layout.ts';
import { actionSchema } from './profile-action-schema.ts';
import { applyAction } from './profile-actions.ts';
import { getProfileLayout } from './profile-tabs.ts';
import type { LinkItem, ProfileData } from './profile-types.ts';

/**
 * Run the existing card forms against a local document projection. Temporary
 * preview IDs are useful inside forms, but must never become published identity.
 */
export function applyDocumentItemDraft(
  profile: ProfileData,
  baseline: ProfileData,
  input: Record<string, unknown>,
  tabId?: string,
): LinkItem {
  const parsed = actionSchema.safeParse({ expectedVersion: 1, ...input });
  if (!parsed.success)
    throw new AppError(parsed.error.issues.map((issue) => issue.message).join(' '));
  const action = parsed.data;
  if (
    action.action !== 'upsert_link' &&
    action.action !== 'upsert_project' &&
    action.action !== 'upsert_interest' &&
    action.action !== 'upsert_collection' &&
    action.action !== 'upsert_discord'
  )
    throw new AppError('Choose an item to add or edit in this document.');

  const targetId = tabId ?? action.tabId;
  const tab = targetId
    ? getProfileLayout(baseline).tabs.find((entry) => entry.id === targetId)
    : undefined;
  if (targetId && !tab) throw new AppError('Page not found.', 404);
  const slugs = tab ? new Set(getLayoutGroups(tab).flatMap((group) => group.slugs)) : null;
  const identities = new Set(
    allItems(baseline.links.filter((item) => !slugs || slugs.has(item.slug))).map(
      (item) => item.id ?? `legacy:${item.slug}`,
    ),
  );

  // This is an isolated draft operation: the editor owns source synchronization.
  const current = { ...profile };
  delete current.documents;
  const changed = applyAction(current, {
    ...action,
    ...(targetId ? { tabId: targetId } : {}),
  }).data;
  const item = changed.links.find((entry) => entry.slug === action.slug);
  if (!item) throw new AppError('The edited item could not be found.');
  function publishedIdentity(value: LinkItem): LinkItem {
    const copy = structuredClone(value);
    if (!copy.id || !identities.has(copy.id)) delete copy.id;
    if (copy.collection) copy.collection.items = copy.collection.items.map(publishedIdentity);
    return copy;
  }
  return publishedIdentity(item);
}
