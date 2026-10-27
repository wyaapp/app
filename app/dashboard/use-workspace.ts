import type { Onboarding } from '@/lib/onboarding';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Profile, Revision, LinkItem, SpaceSummary } from '@/lib/profile-types';
import type { AccountPlanSnapshot } from '@/lib/plans';
import type { FlushEntry } from './use-entry-autosave';
import type { EditingItem } from './item-editor';
import { useDashboardNavigation } from './use-dashboard-navigation';
import {
  parseDashboardRoute,
  type DashboardSection,
  type DashboardBase,
} from '@/lib/dashboard-routes';

export type WorkspaceProps = {
  initial: Profile | null;
  initialOnboarding: Onboarding | null;
  initialTab?: DashboardSection;
  initialSpaces: SpaceSummary[];
  initialPlan: AccountPlanSnapshot;
  initialHistory: Revision[];
  displayName: string;
  signOut: string;
  standalone: boolean;
};
export function useWorkspace(
  {
    initial,
    initialTab,
    initialSpaces,
    initialPlan,
    initialHistory,
    initialOnboarding,
  }: WorkspaceProps,
  {
    base = '/dashboard',
    keepEditorsMounted = false,
  }: { base?: DashboardBase; keepEditorsMounted?: boolean } = {},
) {
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [profile, setProfile] = useState(initial);
  const [spaces, setSpaces] = useState(initialSpaces);
  const [plan, setPlan] = useState(initialPlan);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(initialHistory);
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
    const url = new URL(anchor.href);
    const dashboardRoute =
      url.origin === window.location.origin ? parseDashboardRoute(url, base) : null;
    if (dashboardRoute) {
      event.preventDefault();
      if (!busy || autosaving) void navigate(dashboardRoute);
      return;
    }
    if (!pendingEntry.current) return;
    event.preventDefault();
    if (await finishEntry()) window.location.assign(anchor.href);
  }
  const editTrigger = useRef<HTMLElement | null>(null);
  const deleteTrigger = useRef<HTMLElement | null>(null);
  const addLinkButton = useRef<HTMLButtonElement>(null);
  const [restoring, setRestoring] = useState<Revision | null>(null);
  async function loadSpace(id: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/account?spaceId=${encodeURIComponent(id)}`);
      const result = (await response.json()) as {
        profile: Profile;
        spaces: SpaceSummary[];
        history: Revision[];
        plan?: AccountPlanSnapshot;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || 'Could not load this space.');
      latestProfile.current = result.profile;
      setProfile(result.profile);
      setSpaces(result.spaces);
      if (result.plan) setPlan(result.plan);
      setHistory(result.history);
      setEditing(null);
      setDeleting(null);
      setRestoring(null);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load this space.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  const { route, navigate, replaceRoute } = useDashboardNavigation(
    { section: initialTab === 'links' ? 'files' : (initialTab ?? 'files'), spaceId: initial?.id },
    async (next) => {
      if (mutationInFlight.current && !pendingEntry.current) return false;
      if (!(await finishEntry())) return false;
      if (next.spaceId && next.spaceId !== latestProfile.current?.id) {
        if (!(await loadSpace(next.spaceId))) return false;
      }
      if (!keepEditorsMounted) setEditing(null);
      setDeleting(null);
      setRestoring(null);
      setCreating(false);
      setError('');
      setNotice('');
      return true;
    },
    base,
  );
  const tab = route.section;
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
      const response = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          ...(currentProfile && data.action !== 'create_profile'
            ? {
                spaceId: currentProfile.id,
                expectedVersion: currentProfile.version,
              }
            : {}),
        }),
      });
      const result = (await response.json()) as {
        profile: Profile;
        spaces: SpaceSummary[];
        history: Revision[];
        plan?: AccountPlanSnapshot;
        error?: string;
      };
      if (result.plan) setPlan(result.plan);
      if (!response.ok) {
        if (response.status === 409 && profile) {
          const fresh = (await fetch(`/api/account?spaceId=${encodeURIComponent(profile.id)}`).then(
            (r) => r.json(),
          )) as {
            profile: Profile;
            spaces: SpaceSummary[];
            history: Revision[];
            plan?: AccountPlanSnapshot;
          };
          if (fresh.plan) setPlan(fresh.plan);
          if (fresh.profile?.id === profile.id) {
            setProfile(fresh.profile);
            setHistory(fresh.history);
            setSpaces(fresh.spaces);
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
      if (data.action === 'create_profile') {
        setCreating(false);
        replaceRoute({ section: 'files', spaceId: result.profile.id });
        setEditing(null);
        setDeleting(null);
        setRestoring(null);
      }
      if (!automatic)
        setNotice(
          data.action === 'delete_link' ? 'Item removed.' : 'Saved. Your space is up to date.',
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
    if (!(await finishEntry())) return false;
    setEditing(null);
    setError('');
    requestAnimationFrame(() => {
      if (editTrigger.current?.isConnected) editTrigger.current.focus({ preventScroll: true });
    });
    return true;
  }
  async function edit(link: EditingItem, toggle = true) {
    if (!(await finishEntry())) return;
    if (
      toggle &&
      typeof link === 'object' &&
      typeof editing === 'object' &&
      editing?.slug === link.slug
    ) {
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
  const refreshFiles = useCallback(async () => {
    const id = latestProfile.current?.id;
    if (!id) return;
    const response = await fetch(`/api/account?spaceId=${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Could not refresh published file details.');
    const result = (await response.json()) as {
      profile: Profile;
      spaces: SpaceSummary[];
      history: Revision[];
      plan?: AccountPlanSnapshot;
    };
    if (latestProfile.current?.id !== id || result.profile.version < latestProfile.current.version)
      return;
    latestProfile.current = result.profile;
    setProfile(result.profile);
    setSpaces(result.spaces);
    setHistory(result.history);
    if (result.plan) setPlan(result.plan);
  }, []);

  function selectSpace(id: string) {
    return navigate({ section: tab, spaceId: id });
  }
  return {
    onboarding,
    setOnboarding,
    profile,
    setProfile,
    spaces,
    setSpaces,
    plan,
    setPlan,
    creating,
    setCreating,
    history,
    setHistory,
    tab,
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
    save,
    requestDelete,
    closeEditor,
    edit,
    selectSpace,
    refreshFiles,
    selectSection: (section: DashboardSection) =>
      navigate({ section, spaceId: latestProfile.current?.id }),
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
export type ActiveWorkspace = WorkspaceController & { profile: Profile };
