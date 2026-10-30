export const dashboardSections = [
  'files',
  'profile',
  'domains',
  'billing',
  'metrics',
  'help',
  'feedback',
  'support',
  'history',
  'layout',
] as const;
export type DashboardSection = (typeof dashboardSections)[number];
export type DashboardRoute = { section: DashboardSection; spaceId?: string };
export function isDashboardSection(value: unknown): value is DashboardSection {
  return dashboardSections.some((section) => section === value);
}

export function dashboardHref(section: DashboardSection, spaceId?: string | null) {
  return `/dashboard/${section}${spaceId ? `?space=${encodeURIComponent(spaceId)}` : ''}`;
}

/** Preserve a checkout return only during the initial billing URL normalization. */
export function dashboardInitialHref(route: DashboardRoute, currentUrl: URL) {
  const href = dashboardHref(route.section, route.spaceId);
  const checkout = currentUrl.searchParams.get('checkout');
  if (
    route.section === 'billing' &&
    parseDashboardRoute(currentUrl)?.section === 'billing' &&
    (checkout === 'success' || checkout === 'cancel')
  )
    return `${href}${href.includes('?') ? '&' : '?'}checkout=${checkout}`;
  return href;
}

/** Only the current app routes are accepted. */
export function parseDashboardRoute(url: URL): DashboardRoute | null {
  const path = url.pathname.replace(/\/$/, '');
  const section = path === '/dashboard' ? 'files' : path.slice('/dashboard/'.length);
  if (path !== '/dashboard' && !path.startsWith('/dashboard/')) return null;
  if (!isDashboardSection(section)) return null;
  return {
    section,
    spaceId: url.searchParams.get('space') || undefined,
  };
}
