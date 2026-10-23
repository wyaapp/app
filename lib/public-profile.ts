import { publicItems } from './collections.ts';
import { getProfileLayout, withoutHiddenTabs } from './profile-tabs.ts';
import type { Profile } from './profile-types.ts';
import { publicPageDocuments } from './page-documents.ts';

/** Keep the owner preview and the public response on the same visibility rules. */
export function visibleProfile(profile: Profile): Profile {
  const publicProfile = withoutHiddenTabs(profile);
  const visible = { ...publicProfile, links: publicItems(publicProfile.links) };
  if (visible.tabs?.length) visible.tabs = getProfileLayout(visible).tabs;
  if (visible.documents) visible.documents = publicPageDocuments(visible);
  return visible;
}
