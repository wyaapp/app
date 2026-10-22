import { env } from 'cloudflare:workers';
import { PublicAnalyticsClient } from './public-analytics-client';
import { analyticsSpaceKey } from '@/lib/analytics-key';
import type { Profile } from '@/lib/model';

/** Mount only on successfully resolved public pages, never in the root layout. */
export async function PublicAnalytics({
  path,
  profile,
  customHostname,
}: {
  path: string;
  profile?: Profile;
  customHostname?: string;
}) {
  if (!env.POSTHOG_PROJECT_TOKEN || !env.POSTHOG_HOST) return null;
  const items =
    profile?.links
      .filter((item) => item.visible)
      .flatMap((item) =>
        item.collection ? item.collection.items.filter((child) => child.visible) : [item],
      ) ?? [];
  return (
    <PublicAnalyticsClient
      token={env.POSTHOG_PROJECT_TOKEN}
      host={env.POSTHOG_HOST}
      path={path}
      customHostname={customHostname}
      spaceKey={profile ? await analyticsSpaceKey(profile.id) : undefined}
      items={JSON.stringify(items.map((item) => item.id ?? `legacy:${item.slug}`))}
    />
  );
}
