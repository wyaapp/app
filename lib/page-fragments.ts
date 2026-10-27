import type { ProfileData } from './profile-types.ts';
import { getProfileLayout } from './profile-tabs.ts';
import { getLayoutGroups } from './link-layout.ts';
import { parseFileDocument } from './file-documents.ts';
import { documentCardDomId } from './document-card-links.ts';
import { isRichTextFile } from './file-formats.ts';

/** Locate the actual Markdown file for current and pre-migration item bookmarks. */
export function fileForFragment(profile: ProfileData, fragment: string) {
  if (!fragment) return undefined;
  const files = profile.files ?? [];
  // Old bookmarks have no file identity. Resolve their published index owner
  // before inspecting copies, which may retain the same stable card ID.
  if (/^(widget|interest)-/.test(fragment)) {
    for (const parent of profile.links) {
      const indexed = [parent, ...(parent.collection?.items ?? [])].find((item) =>
        ['widget', 'interest'].some((prefix) => fragment === documentCardDomId(null, prefix, item)),
      );
      if (indexed?.fileId) return files.find((file) => file.id === indexed.fileId);
    }
  }
  return files.find((file) => {
    if (!isRichTextFile(file.name)) return false;
    try {
      return parseFileDocument(file.content).data.links.some((parent) =>
        [parent, ...(parent.collection?.items ?? [])].some((item) =>
          ['widget', 'interest'].some(
            (prefix) =>
              fragment === documentCardDomId(file.id, prefix, item) ||
              fragment === documentCardDomId(null, prefix, item),
          ),
        ),
      );
    } catch {
      return false;
    }
  });
}

export function fileFragmentTarget(fileId: string, fragment: string) {
  return /^(widget|interest)-/.test(fragment) ? `file-${fileId}-${fragment}` : fragment;
}

/** Content short links locate their page by stable item identity, without page URL parameters. */
export function pageForFragment(profile: ProfileData, fragment: string) {
  if (!fragment) return undefined;
  const item = profile.links.find(
    (item) =>
      [`widget-${item.id ?? item.slug}`, `interest-${item.id ?? item.slug}`].includes(fragment) ||
      item.collection?.items.some((child) => `interest-${child.id ?? child.slug}` === fragment),
  );
  return item
    ? getProfileLayout(profile).tabs.find((page) =>
        getLayoutGroups(page).some((group) => group.slugs.includes(item.slug)),
      )
    : undefined;
}
