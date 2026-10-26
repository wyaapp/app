export const dashboardSections = [
  'links',
  'profile',
  'domains',
  'billing',
  'metrics',
  'chatgpt',
  'help',
  'feedback',
  'support',
  'history',
] as const;
export type DashboardSection = (typeof dashboardSections)[number];
export type DashboardRoute = { section: DashboardSection; spaceId?: string };
export type DashboardBase = '/dashboard' | '/experimental-dashboard';

/** Old ChatGPT links open its guide inside the shared Help window. */
export function dashboardWindowId(section: DashboardSection) {
  return `owner-${section === 'chatgpt' ? 'help' : section}`;
}

export function isDashboardSection(value: unknown): value is DashboardSection {
  return dashboardSections.some((section) => section === value);
}

export function dashboardHref(
  section: DashboardSection,
  spaceId?: string | null,
  base: DashboardBase = '/dashboard',
) {
  return `${base}/${section}${spaceId ? `?space=${encodeURIComponent(spaceId)}` : ''}`;
}

/** Preserve a checkout return only during the initial billing URL normalization. */
export function dashboardInitialHref(
  route: DashboardRoute,
  currentUrl: URL,
  base: DashboardBase = '/dashboard',
) {
  const href = dashboardHref(route.section, route.spaceId, base);
  const checkout = currentUrl.searchParams.get('checkout');
  if (
    route.section === 'billing' &&
    parseDashboardRoute(currentUrl, base)?.section === 'billing' &&
    (checkout === 'success' || checkout === 'cancel')
  )
    return `${href}${href.includes('?') ? '&' : '?'}checkout=${checkout}`;
  return href;
}

/** Also understands old bookmarks and picture-editor links from the connector. */
export function parseDashboardRoute(
  url: URL,
  base: DashboardBase = '/dashboard',
): DashboardRoute | null {
  const path = url.pathname.replace(/\/$/, '');
  const section =
    path === base ? url.searchParams.get('tab') || 'links' : path.slice(base.length + 1);
  if (path !== base && !path.startsWith(`${base}/`)) return null;
  if (!isDashboardSection(section)) return null;
  return { section, spaceId: url.searchParams.get('space') || undefined };
}
