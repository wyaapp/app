import { AppError } from './app-error.ts';
import type { ProfileData } from './profile-types.ts';
import type { Action } from './profile-action-schema.ts';
import { prepareTabImport } from './tab-transfer.ts';
import { prepareContentPaste } from './content-clipboard.ts';
import { saveCollection, groupGames } from './collections.ts';
import { getProfileLayout, applyProfileLayout } from './profile-tabs.ts';
import { applyLayout, MAX_SECTIONS } from './link-layout.ts';
import { upsertItem } from './item-mutations.ts';
import { compilePageDocument } from './page-document-actions.ts';
import { syncPageDocuments } from './page-documents.ts';
import { normalizeMainWindowId } from './main-window.ts';
import { publicProfileFiles } from './profile-files.ts';

export function applyAction(
  data: ProfileData,
  action: Action,
): { data: ProfileData; reason: string } {
  const result = applyContentAction(data, action);
  if (data.documents && action.action !== 'publish_document' && action.action !== 'import_tab')
    result.data = syncPageDocuments(
      data,
      result.data,
      action.action === 'set_tabs' ? action.removedTabTransfer : undefined,
    );
  return result;
}

function applyContentAction(
  data: ProfileData,
  action: Action,
): { data: ProfileData; reason: string } {
  const next = structuredClone(data);
  switch (action.action) {
    case 'publish_document':
      return {
        data: compilePageDocument(next, action.tabId, action.source, action.appearance),
        reason: 'Published page document',
      };
    case 'paste_content':
      return {
        data: prepareContentPaste(next, action.content, action.tabId, action.sectionId).data,
        reason: action.content.kind === 'section' ? 'Pasted section' : 'Pasted item',
      };
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
      if (action.font !== undefined) next.font = action.font;
      if (action.pageStyle !== undefined) next.pageStyle = action.pageStyle;
      if (action.desktopOrder !== undefined) next.desktopOrder = action.desktopOrder;
      if (action.mobileLayout === null) delete next.mobileLayout;
      else if (action.mobileLayout !== undefined) {
        const available = new Set(publicProfileFiles(next.files ?? []).map((file) => file.id));
        if (action.mobileLayout.fileIds.some((id) => !available.has(id)))
          throw new AppError('Choose published files from this space for the mobile layout.');
        next.mobileLayout = { ...action.mobileLayout, fileIds: [...action.mobileLayout.fileIds] };
      }
      if (action.mainWindowId === null) delete next.mainWindowId;
      else if (action.mainWindowId !== undefined) {
        const mainWindowId = normalizeMainWindowId(
          action.mainWindowId,
          publicProfileFiles(
            (next.files ?? []).filter((file) => `file-${file.id}` === action.mainWindowId),
          ),
        );
        if (!mainWindowId)
          throw new AppError('Choose a public app or a published file as the Main window.');
        next.mainWindowId = mainWindowId;
      }
      return { data: next, reason: 'Updated profile' };
    case 'upsert_link':
    case 'upsert_project':
    case 'upsert_interest':
    case 'upsert_discord':
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
      if (action.removedTabTransfer) {
        const { fromTabId, toTabId } = action.removedTabTransfer;
        const previousIds = new Set(getProfileLayout(data).tabs.map((tab) => tab.id));
        if (
          !previousIds.has(fromTabId) ||
          action.tabs.some((tab) => tab.id === fromTabId) ||
          !previousIds.has(toTabId) ||
          !action.tabs.some((tab) => tab.id === toTabId)
        )
          throw new AppError('Move content from a removed page to an existing page.');
      }
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
        const saved = next.tabs?.find((saved) => saved.id === tab.id);
        const hidden = tab.hidden ?? saved?.hidden;
        const appearance = tab.appearance ?? saved?.appearance;
        return {
          ...tab,
          ...(hidden !== undefined ? { hidden } : {}),
          ...(appearance !== undefined ? { appearance } : {}),
        };
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
      return applyContentAction(next, {
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
