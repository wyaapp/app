import type { Onboarding } from '@/lib/onboarding';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Profile, Revision, SpaceSummary } from '@/lib/profile-types';
import type { AccountPlanSnapshot } from '@/lib/plans';
import { useDashboardNavigation } from './use-dashboard-navigation';
import { parseDashboardRoute, type DashboardSection } from '@/lib/dashboard-routes';

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
export type DashboardData = Pick<
  WorkspaceProps,
  | 'initial'
  | 'initialSpaces'
  | 'initialPlan'
  | 'initialOnboarding'
  | 'initialHistory'
  | 'displayName'
  | 'signOut'
  | 'standalone'
> & { error?: string };
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
    beforeNavigate,
  }: {
    beforeNavigate?: () => Promise<boolean>;
  } = {},
) {
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [profile, setProfile] = useState(initial);
  const [spaces, setSpaces] = useState(initialSpaces);
  const [plan, setPlan] = useState(initialPlan);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(initialHistory);
  const [busy, setBusy] = useState(false);
  const mutationInFlight = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const latestProfile = useRef(profile);
  useEffect(() => {
    latestProfile.current = profile;
  }, [profile]);
  async function prepareNavigation() {
    if (mutationInFlight.current || busy) return false;
    return beforeNavigate ? beforeNavigate() : true;
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
    const dashboardRoute = url.origin === window.location.origin ? parseDashboardRoute(url) : null;
    if (dashboardRoute) {
      event.preventDefault();
      if (!busy) void navigate(dashboardRoute);
      return;
    }
    if (!beforeNavigate) return;
    event.preventDefault();
    if (await prepareNavigation()) window.location.assign(anchor.href);
  }
  const [restoring, setRestoring] = useState<Revision | null>(null);
  async function loadSpace(id: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/dashboard?spaceId=${encodeURIComponent(id)}`);
      const data = (await response.json()) as DashboardData;
      const result = {
        profile: data.initial,
        spaces: data.initialSpaces,
        history: data.initialHistory,
        plan: data.initialPlan,
        error: data.error,
      } as {
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
    { section: initialTab ?? 'files', spaceId: initial?.id },
    async (next) => {
      if (!(await prepareNavigation())) return false;
      if (next.spaceId && next.spaceId !== latestProfile.current?.id) {
        if (!(await loadSpace(next.spaceId))) return false;
      }
      setRestoring(null);
      setCreating(false);
      setError('');
      setNotice('');
      return true;
    },
  );
  const tab = route.section;
  async function save(data: Record<string, unknown>) {
    if (mutationInFlight.current || busy) return false;
    mutationInFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const currentProfile = latestProfile.current;
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
      if (data.action === 'create_profile') {
        setCreating(false);
        replaceRoute({ section: 'files', spaceId: result.profile.id });
        setRestoring(null);
      }
      setNotice('Saved. Your space is up to date.');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your changes.');
      return false;
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }
  const refreshFiles = useCallback(async () => {
    const id = latestProfile.current?.id;
    if (!id) return;
    const response = await fetch(`/api/dashboard?spaceId=${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Could not refresh published file details.');
    const data = (await response.json()) as DashboardData;
    const result = {
      profile: data.initial as Profile,
      spaces: data.initialSpaces as SpaceSummary[],
      history: data.initialHistory as Revision[],
      plan: data.initialPlan as AccountPlanSnapshot,
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
    error,
    setError,
    notice,
    setNotice,
    latestProfile,
    prepareNavigation,
    navigateFromEditor,
    restoring,
    setRestoring,
    save,
    selectSpace,
    refreshFiles,
    selectSection: (section: DashboardSection) =>
      navigate({ section, spaceId: latestProfile.current?.id }),
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
export type ActiveWorkspace = WorkspaceController & { profile: Profile };
