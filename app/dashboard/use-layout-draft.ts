import { useEffect, useState } from 'react';
import type { Profile } from '@/lib/profile-types';
import {
  getProfileLayout,
  reconcileProfileLayout,
  applyProfileLayout,
  moveItemToTab,
  type ProfileLayout,
} from '@/lib/profile-tabs';

/** Unsaved ordering belongs to each space and survives switching between spaces. */
export function useLayoutDraft(profile: Profile | null) {
  const [layouts, setLayouts] = useState<Record<string, ProfileLayout>>({});
  const [selectedProfileTab, setSelectedProfileTab] = useState('');
  const profileLayout = profile
    ? reconcileProfileLayout(layouts[profile.id] ?? getProfileLayout(profile), profile)
    : {
        tabs: [{ id: 'home', title: 'Home', slug: 'home', ungrouped: [], sections: [] }],
        defaultTabId: 'home',
      };
  const activeProfileTab =
    profileLayout.tabs.find((tab) => tab.id === selectedProfileTab) ??
    profileLayout.tabs.find((tab) => tab.id === profileLayout.defaultTabId)!;
  const layout = activeProfileTab;
  const newProfileTab =
    !!profile && !getProfileLayout(profile).tabs.some((tab) => tab.id === activeProfileTab.id);
  const previewProfile = profile ? applyProfileLayout(profile, profileLayout) : null;
  const layoutChanged =
    !!profile && JSON.stringify(profileLayout) !== JSON.stringify(getProfileLayout(profile));
  const layoutInvalid =
    profileLayout.tabs.some(
      (tab) =>
        !tab.title.trim() ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tab.slug) ||
        tab.sections.some((section) => !section.title.trim()),
    ) || new Set(profileLayout.tabs.map((tab) => tab.slug)).size !== profileLayout.tabs.length;
  useEffect(() => {
    if (!Object.keys(layouts).length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [layouts]);
  function discardLayout(id: string) {
    setLayouts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }
  function syncLayout(
    updated: Profile,
    rename?: { from: string; to: string },
    newItem?: { slug: string; tabId: string },
  ) {
    setLayouts((current) => {
      if (!current[updated.id] && !newItem) return current;
      let layout = reconcileProfileLayout(
        current[updated.id] ?? getProfileLayout(updated),
        updated,
        rename,
      );
      if (newItem) layout = moveItemToTab(layout, newItem.slug, newItem.tabId);
      const next = { ...current, [updated.id]: layout };
      if (JSON.stringify(layout) === JSON.stringify(getProfileLayout(updated)))
        delete next[updated.id];
      return next;
    });
  }
  return {
    layouts,
    setLayouts,
    selectedProfileTab,
    setSelectedProfileTab,
    profileLayout,
    activeProfileTab,
    layout,
    newProfileTab,
    previewProfile,
    layoutChanged,
    layoutInvalid,
    discardLayout,
    syncLayout,
  };
}
