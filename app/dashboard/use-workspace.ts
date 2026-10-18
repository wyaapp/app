import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Profile, Revision, LinkItem, SpaceSummary } from '@/lib/profile-types';
import { getProfileLayout, reconcileProfileLayout, type ProfileLayout } from '@/lib/profile-tabs';
import type { LinkLayout } from '@/lib/link-layout';
import type { FlushEntry } from './use-entry-autosave';
import type { EditingItem } from './item-editor';
import { useLayoutDraft } from './use-layout-draft';

export type Tab = 'links' | 'profile' | 'chatgpt' | 'history' | 'metrics';
export type WorkspaceProps = {
  initial: Profile | null;
  initialTab?: Tab;
  initialSpaces: SpaceSummary[];
  initialHistory: Revision[];
  displayName: string;
  signOut: string;
  standalone: boolean;
};
export function useWorkspace({
  initial,
  initialTab,
  initialSpaces,
  initialHistory,
}: WorkspaceProps) {
  const [profile, setProfile] = useState(initial);
  const [spaces, setSpaces] = useState(initialSpaces);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(initialHistory);
  const [tab, setTab] = useState<Tab>(initialTab || 'links');
  const [busy, setBusy] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const mutationInFlight = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<EditingItem | null>(null);
  const [deleting, setDeleting] = useState<LinkItem | null>(null);
  const latestProfile = useRef(profile);
  useEffect(() => {
    latestProfile.current = profile;
  }, [profile]);
  const pendingEntry = useRef<FlushEntry | null>(null);
  const registerAutosave = useCallback((flush: FlushEntry | null) => {
    pendingEntry.current = flush;
  }, []);
  async function finishEntry() {
    return pendingEntry.current ? pendingEntry.current() : true;
  }
  async function navigateFromEditor(event: MouseEvent<HTMLDivElement>) {
    if (
      !pendingEntry.current ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (
      !anchor ||
      anchor.target === '_blank' ||
      anchor.hasAttribute('download') ||
      anchor.getAttribute('href')?.startsWith('#')
    )
      return;
    event.preventDefault();
    if (await finishEntry()) window.location.assign(anchor.href);
  }
  const editTrigger = useRef<HTMLElement | null>(null);
  const deleteTrigger = useRef<HTMLElement | null>(null);
  const addLinkButton = useRef<HTMLButtonElement>(null);
  const [restoring, setRestoring] = useState<Revision | null>(null);
  const {
    layouts,
    setLayouts,
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
  } = useLayoutDraft(profile);
  async function selectProfileTab(id: string) {
    if (!(await finishEntry())) return;
    setSelectedProfileTab(id);
    setEditing(null);
    setError('');
  }
  function changeLayout(next: LinkLayout) {
    changeProfileLayout({
      ...profileLayout,
      tabs: profileLayout.tabs.map((tab) =>
        tab.id === activeProfileTab.id
          ? { id: tab.id, title: tab.title, slug: tab.slug, ...next }
          : tab,
      ),
    });
  }
  async function changeProfileLayout(next: ProfileLayout) {
    if (!profile || busy) return;
    if (!(await finishEntry())) return;
    if (JSON.stringify(next) === JSON.stringify(getProfileLayout(profile)))
      discardLayout(profile.id);
    else setLayouts((current) => ({ ...current, [profile.id]: next }));
    setNotice('');
  }
  async function save(data: Record<string, unknown>, automatic = false) {
    if (mutationInFlight.current || (busy && !autosaving)) return false;
    mutationInFlight.current = true;
    setAutosaving(automatic);
    setBusy(true);
    setError('');
    if (!automatic) setNotice('');
    const currentProfile = latestProfile.current;
    if (automatic && typeof editing === 'object' && editing && data.originalSlug !== undefined) {
      const saved = currentProfile?.links.find((item) =>
        editing.id ? item.id === editing.id : item.slug === editing.slug,
      );
      if (saved) data = { ...data, originalSlug: saved.slug };
    }
    try {
      if (data.action === 'import_tab' && layoutChanged)
        throw new Error('Save or discard layout changes before importing.');
      if (data.action === 'group_games' && layoutChanged)
        throw new Error('Save or discard your layout changes before grouping games.');
      const newItem =
        !automatic &&
        (data.action === 'upsert_link' ||
          data.action === 'upsert_project' ||
          data.action === 'upsert_interest' ||
          data.action === 'upsert_collection') &&
        !profile?.links.some((link) => link.slug === (data.originalSlug ?? data.slug)) &&
        typeof data.slug === 'string'
          ? { slug: data.slug.trim().toLowerCase(), tabId: activeProfileTab.id }
          : undefined;
      if (newItem && newProfileTab)
        throw new Error('Save layout before adding items to this new tab.');
      if (
        newItem &&
        profile &&
        getProfileLayout(profile).tabs.some((tab) => tab.id === newItem.tabId)
      )
        data = { ...data, tabId: newItem.tabId };
      const response = await fetch(
        data.action === 'import_tab' ? '/api/account/import' : '/api/account',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...data,
            ...(currentProfile && data.action !== 'create_profile'
              ? { spaceId: currentProfile.id, expectedVersion: currentProfile.version }
              : {}),
          }),
        },
      );
      const result = (await response.json()) as {
        profile: Profile;
        spaces: SpaceSummary[];
        history: Revision[];
        error?: string;
      };
      if (!response.ok) {
        if (response.status === 409 && profile) {
          const fresh = (await fetch(`/api/account?spaceId=${encodeURIComponent(profile.id)}`).then(
            (r) => r.json(),
          )) as { profile: Profile; spaces: SpaceSummary[]; history: Revision[] };
          if (fresh.profile?.id === profile.id) {
            setProfile(fresh.profile);
            setHistory(fresh.history);
            setSpaces(fresh.spaces);
            syncLayout(fresh.profile);
          }
        }
        throw new Error(result.error || 'Could not save your changes.');
      }
      latestProfile.current = result.profile;
      setProfile(result.profile);
      setHistory(result.history);
      setSpaces(result.spaces);
      if (automatic)
        setEditing((current) =>
          typeof current === 'object' && current
            ? (result.profile.links.find(
                (item) =>
                  (item.id === current.id && !!item.id) ||
                  item.slug === (data.slug ?? current.slug),
              ) ?? current)
            : current,
        );
      if (data.action === 'import_tab') {
        setEditing(null);
        setSelectedProfileTab(result.profile.tabs!.at(-1)!.id);
      }
      if (
        data.action === 'import_tab' ||
        data.action === 'set_tabs' ||
        data.action === 'set_layout' ||
        data.action === 'restore_revision' ||
        data.action === 'group_games'
      )
        discardLayout(result.profile.id);
      else
        syncLayout(
          result.profile,
          (data.action === 'upsert_link' ||
            data.action === 'upsert_project' ||
            data.action === 'upsert_interest' ||
            data.action === 'upsert_collection') &&
            typeof data.originalSlug === 'string' &&
            typeof data.slug === 'string'
            ? { from: data.originalSlug, to: data.slug.trim().toLowerCase() }
            : undefined,
          newItem,
        );
      window.history.replaceState(
        null,
        '',
        `/dashboard?space=${encodeURIComponent(result.profile.id)}`,
      );
      if (data.action === 'create_profile') {
        setCreating(false);
        setTab('links');
        setEditing(null);
        setDeleting(null);
        setRestoring(null);
      }
      const draft = layouts[result.profile.id];
      const remainingDraft =
        draft &&
        JSON.stringify(reconcileProfileLayout(draft, result.profile)) !==
          JSON.stringify(getProfileLayout(result.profile));
      if (!automatic)
        setNotice(
          data.action === 'delete_link'
            ? remainingDraft
              ? 'Item removed. Your other layout changes are still unsaved.'
              : 'Item removed.'
            : remainingDraft && data.action !== 'set_tabs' && data.action !== 'restore_revision'
              ? 'Saved. Your other layout changes are still unsaved.'
              : 'Saved. Your space is up to date.',
        );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your changes.');
      return false;
    } finally {
      mutationInFlight.current = false;
      setAutosaving(false);
      setBusy(false);
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${profile!.handle}`);
      setNotice('Profile link copied.');
    } catch {
      setError('Copy failed. Open your profile and copy its address.');
    }
  }
  async function requestDelete(link: LinkItem) {
    if (!(await finishEntry())) return;
    deleteTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(null);
    setError('');
    setNotice('');
    setDeleting(
      latestProfile.current?.links.find((item) =>
        link.id ? item.id === link.id : item.slug === link.slug,
      ) ?? link,
    );
  }
  async function closeEditor() {
    if (!(await finishEntry())) return;
    setEditing(null);
    setError('');
    requestAnimationFrame(() => {
      if (editTrigger.current?.isConnected) editTrigger.current.focus({ preventScroll: true });
    });
  }
  async function edit(link: EditingItem) {
    if (!(await finishEntry())) return;
    if (typeof link === 'object' && typeof editing === 'object' && editing?.slug === link.slug) {
      closeEditor();
      return;
    }
    editTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(link);
    setDeleting(null);
    setError('');
    setNotice('');
  }
  async function selectSpace(id: string) {
    if (busy || id === profile?.id) return;
    if (!(await finishEntry())) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/account?spaceId=${encodeURIComponent(id)}`);
      const result = (await response.json()) as {
        profile: Profile;
        spaces: SpaceSummary[];
        history: Revision[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || 'Could not load this space.');
      setProfile(result.profile);
      setSpaces(result.spaces);
      setHistory(result.history);
      syncLayout(result.profile);
      setEditing(null);
      setDeleting(null);
      setRestoring(null);
      setSelectedProfileTab('');
      setTab('links');
      window.history.replaceState(null, '', `/dashboard?space=${encodeURIComponent(id)}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load this space.');
    } finally {
      setBusy(false);
    }
  }
  return {
    profile,
    setProfile,
    spaces,
    setSpaces,
    creating,
    setCreating,
    history,
    setHistory,
    tab,
    setTab,
    busy,
    setBusy,
    autosaving,
    error,
    setError,
    notice,
    setNotice,
    editing,
    setEditing,
    deleting,
    setDeleting,
    latestProfile,
    registerAutosave,
    finishEntry,
    navigateFromEditor,
    deleteTrigger,
    addLinkButton,
    restoring,
    setRestoring,
    profileLayout,
    activeProfileTab,
    layout,
    newProfileTab,
    previewProfile,
    layoutChanged,
    layoutInvalid,
    selectProfileTab,
    discardLayout,
    syncLayout,
    changeLayout,
    changeProfileLayout,
    save,
    copyLink,
    requestDelete,
    closeEditor,
    edit,
    selectSpace,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
export type ActiveWorkspace = WorkspaceController & { profile: Profile };
