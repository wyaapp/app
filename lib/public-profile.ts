import { publicItems } from './collections.ts';
import { getProfileLayout, withoutHiddenTabs } from './profile-tabs.ts';
import type { Profile } from './profile-types.ts';

/** Keep the owner preview and the public response on the same visibility rules. */
export function visibleProfile(profile: Profile): Profile {
  const publicProfile = withoutHiddenTabs(profile);
  const visible = { ...publicProfile, links: publicItems(publicProfile.links) };
  if (visible.tabs?.length) visible.tabs = getProfileLayout(visible).tabs;
  return visible;
}
