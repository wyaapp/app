export const dashboardSections = ['links', 'profile', 'metrics', 'chatgpt', 'history'] as const;
export type DashboardSection = (typeof dashboardSections)[number];
export type DashboardRoute = { section: DashboardSection; spaceId?: string };

export function isDashboardSection(value: unknown): value is DashboardSection {
  return dashboardSections.some((section) => section === value);
}

export function dashboardHref(section: DashboardSection, spaceId?: string | null) {
  return `/dashboard/${section}${spaceId ? `?space=${encodeURIComponent(spaceId)}` : ''}`;
}

/** Also understands old bookmarks and picture-editor links from the connector. */
export function parseDashboardRoute(url: URL): DashboardRoute | null {
  const path = url.pathname.replace(/\/$/, '');
  const section = path === '/dashboard' ? url.searchParams.get('tab') || 'links' : path.slice(11);
  if (path !== '/dashboard' && !path.startsWith('/dashboard/')) return null;
  if (!isDashboardSection(section)) return null;
  return { section, spaceId: url.searchParams.get('space') || undefined };
}
