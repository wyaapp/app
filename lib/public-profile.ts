import { publicItems } from './collections.ts';
import { getProfileLayout, withoutHiddenTabs } from './profile-tabs.ts';
import type { Profile } from './profile-types.ts';
import { publicPageDocuments } from './page-documents.ts';
import { publicProfileFiles, profileFileLinks } from './profile-files.ts';

/** Keep the owner preview and the public response on the same visibility rules. */
export function visibleProfile(profile: Profile): Profile {
  // A lightweight canonical read already contains only the published index.
  if (profile.fileModelVersion === 1 && !profile.files) {
    return { ...profile, links: publicItems(profile.links) };
  }
  if (profile.files) {
    const files = publicProfileFiles(profile.files);
    const visible = {
      ...profile,
      files,
      links: profileFileLinks(files, false),
      defaultFileId: files.some((file) => file.id === profile.defaultFileId)
        ? profile.defaultFileId
        : files[0]?.id,
    };
    // Legacy layouts may be computed by mutation adapters, never sent publicly.
    delete visible.tabs;
    delete visible.defaultTabId;
    delete visible.documents;
    delete visible.sections;
    delete visible.ungroupedPosition;
    if (!visible.defaultFileId) delete visible.defaultFileId;
    return visible;
  }
  const publicProfile = withoutHiddenTabs(profile);
  const visible = { ...publicProfile, links: publicItems(publicProfile.links) };
  if (visible.tabs?.length) visible.tabs = getProfileLayout(visible).tabs;
  if (visible.documents) visible.documents = publicPageDocuments(visible);
  return visible;
}
