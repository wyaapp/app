import { AppError } from './app-error.ts';
import type { ProfileData } from './profile-types.ts';
import type { Action } from './profile-action-schema.ts';
import { prepareTabImport } from './tab-transfer.ts';
import { saveCollection, groupGames } from './collections.ts';
import { getProfileLayout, applyProfileLayout } from './profile-tabs.ts';
import { applyLayout, MAX_SECTIONS } from './link-layout.ts';
import { upsertItem } from './item-mutations.ts';

export function applyAction(
  data: ProfileData,
  action: Action,
): { data: ProfileData; reason: string } {
  const next = structuredClone(data);
  switch (action.action) {
    case 'import_tab':
      return {
        data: prepareTabImport(next, action.file).data,
        reason: `Imported tab ${action.file.tab.title}`,
      };
    case 'upsert_collection':
      return {
        data: saveCollection(next, action),
        reason:
          action.originalSlug && action.originalSlug !== action.slug
            ? `Changed /${action.originalSlug} to /${action.slug}`
            : `Saved games widget /${action.slug}`,
      };
    case 'group_games':
      return { data: groupGames(next, action), reason: `Grouped games into /${action.slug}` };
    case 'update_profile':
      if (action.name !== undefined) next.name = action.name;
      if (action.bio !== undefined) next.bio = action.bio;
      if (action.theme !== undefined) next.theme = action.theme;
      return { data: next, reason: 'Updated profile' };
    case 'upsert_link':
    case 'upsert_project':
    case 'upsert_interest':
      return upsertItem(next, action);
    case 'delete_link':
      if (!next.links.some((l) => l.slug === action.slug))
        throw new AppError('Link not found.', 404);
      next.links = next.links.filter((l) => l.slug !== action.slug);
      if (next.tabs) Object.assign(next, applyProfileLayout(next, getProfileLayout(next)));
      return { data: next, reason: `Removed /${action.slug}` };
    case 'set_tabs': {
      const sections = action.tabs.flatMap((tab) => tab.sections);
      const slugs = action.tabs.flatMap((tab) => [
        ...tab.ungrouped,
        ...tab.sections.flatMap((section) => section.slugs),
      ]);
      if (
        new Set(action.tabs.map((tab) => tab.id)).size !== action.tabs.length ||
        new Set(action.tabs.map((tab) => tab.slug)).size !== action.tabs.length
      )
        throw new AppError('Tab IDs and URL names must be unique.');
      if (!action.tabs.some((tab) => tab.id === action.defaultTabId))
        throw new AppError('Choose an existing default tab.');
      if (
        sections.length > MAX_SECTIONS ||
        new Set(sections.map((section) => section.id)).size !== sections.length
      )
        throw new AppError('Use up to 20 sections with unique IDs across all tabs.');
      if (action.tabs.some((tab) => (tab.ungroupedPosition ?? 0) > tab.sections.length))
        throw new AppError('The ungrouped position must be within its tab.');
      if (
        slugs.length !== next.links.length ||
        new Set(slugs).size !== next.links.length ||
        slugs.some((slug) => !next.links.some((link) => link.slug === slug))
      )
        throw new AppError(
          'Include every existing item exactly once across all tabs, including hidden items.',
        );
      const tabs = action.tabs.map((tab) => {
        const hidden = tab.hidden ?? next.tabs?.find((saved) => saved.id === tab.id)?.hidden;
        return hidden === undefined ? tab : { ...tab, hidden };
      });
      return {
        data: applyProfileLayout(next, { ...action, tabs }),
        reason: 'Updated profile tabs and layout',
      };
    }
    case 'set_layout': {
      const profileLayout = getProfileLayout(next);
      if (profileLayout.tabs.length > 1 && !action.tabId)
        throw new AppError(
          'Choose a tab with tabId, or use set_tabs to organize the whole profile.',
        );
      const target = profileLayout.tabs.find(
        (tab) => tab.id === (action.tabId ?? profileLayout.defaultTabId),
      );
      if (!target) throw new AppError('Tab not found.', 404);
      if (
        action.ungroupedPosition !== undefined &&
        action.ungroupedPosition > action.sections.length
      )
        throw new AppError('The ungrouped position must be within the layout.');
      const slugs = [...action.ungrouped, ...action.sections.flatMap((section) => section.slugs)];
      const existing = [
        ...target.ungrouped,
        ...target.sections.flatMap((section) => section.slugs),
      ];
      if (new Set(action.sections.map((section) => section.id)).size !== action.sections.length)
        throw new AppError('Each section needs a unique ID.');
      if (
        slugs.length !== existing.length ||
        new Set(slugs).size !== existing.length ||
        slugs.some((slug) => !existing.includes(slug))
      )
        throw new AppError(
          'Include every existing link exactly once in the layout, including hidden links.',
        );
      const layout = {
        ungrouped: action.ungrouped,
        sections: action.sections,
        ungroupedPosition:
          action.ungroupedPosition ??
          Math.min(target.ungroupedPosition ?? 0, action.sections.length),
      };
      if (!next.tabs) return { data: applyLayout(next, layout), reason: 'Updated link layout' };
      return applyAction(next, {
        action: 'set_tabs',
        expectedVersion: action.expectedVersion,
        ...profileLayout,
        tabs: profileLayout.tabs.map((tab) => (tab.id === target.id ? { ...tab, ...layout } : tab)),
      });
    }
    case 'reorder_links':
      if (
        action.slugs.length !== next.links.length ||
        new Set(action.slugs).size !== next.links.length ||
        action.slugs.some((s) => !next.links.some((l) => l.slug === s))
      )
        throw new AppError('Include every existing link exactly once.');
      next.links = action.slugs.map((s) => next.links.find((l) => l.slug === s)!);
      if (next.tabs) {
        const order = (slugs: string[]) =>
          [...slugs].sort((a, b) => action.slugs.indexOf(a) - action.slugs.indexOf(b));
        next.tabs = next.tabs.map((tab) => ({
          ...tab,
          ungrouped: order(tab.ungrouped),
          sections: tab.sections.map((section) => ({ ...section, slugs: order(section.slugs) })),
        }));
      }
      return { data: next, reason: 'Reordered links' };
    default:
      throw new AppError('This operation requires account storage.');
  }
}
