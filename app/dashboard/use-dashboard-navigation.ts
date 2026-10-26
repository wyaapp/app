import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dashboardHref,
  dashboardInitialHref,
  parseDashboardRoute,
  type DashboardRoute,
  type DashboardBase,
} from '@/lib/dashboard-routes';

/**
 * All sections share the same workspace. Native history keeps its drafts mounted;
 * the server route handles direct visits, reloads and opening links in a new tab.
 */
export function useDashboardNavigation(
  initial: DashboardRoute,
  prepare: (route: DashboardRoute) => Promise<boolean>,
  base: DashboardBase = '/dashboard',
) {
  const [route, setRoute] = useState(initial);
  const current = useRef(initial);
  const prepareRef = useRef(prepare);
  const queue = useRef(Promise.resolve(true));
  const request = useRef(0);
  useEffect(() => {
    prepareRef.current = prepare;
  });

  const replaceRoute = useCallback(
    (next: DashboardRoute) => {
      current.current = next;
      setRoute(next);
      window.history.replaceState(null, '', dashboardHref(next.section, next.spaceId, base));
    },
    [base],
  );

  const navigate = useCallback(
    (next: DashboardRoute, mode: 'push' | 'pop' = 'push') => {
      const id = ++request.current;
      // Serialize navigation with autosave and space loading. Rapid clicks use the last target.
      queue.current = queue.current.then(async () => {
        if (id !== request.current) return false;
        const previous = current.current;
        const unchanged = next.section === previous.section && next.spaceId === previous.spaceId;
        if (!(await prepareRef.current(next))) {
          if (id === request.current)
            window.history.replaceState(
              null,
              '',
              dashboardHref(previous.section, previous.spaceId, base),
            );
          return false;
        }
        if (id !== request.current) return false;
        current.current = next;
        setRoute(next);
        if (mode === 'push' && !unchanged)
          window.history.pushState(null, '', dashboardHref(next.section, next.spaceId, base));
        return true;
      });
      return queue.current;
    },
    [base],
  );

  useEffect(() => {
    // Include the resolved space in copied URLs, even when the visit used /dashboard.
    window.history.replaceState(
      null,
      '',
      dashboardInitialHref(current.current, new URL(window.location.href), base),
    );
    const onPopState = () => {
      const next = parseDashboardRoute(new URL(window.location.href), base);
      if (next) void navigate(next, 'pop');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [navigate, base]);

  return { route, navigate, replaceRoute };
}
