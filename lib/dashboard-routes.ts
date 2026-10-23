export const dashboardSections = [
  'links',
  'profile',
  'domains',
  'metrics',
  'chatgpt',
  'history',
] as const;
export type DashboardSection = (typeof dashboardSections)[number];
export type DashboardRoute = { section: DashboardSection; spaceId?: string };
export type DashboardBase = '/dashboard' | '/experimental-dashboard';

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
