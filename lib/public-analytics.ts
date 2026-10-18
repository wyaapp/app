import type { CaptureResult, PostHogConfig } from 'posthog-js';

export const posthogHosts = ['https://eu.i.posthog.com', 'https://us.i.posthog.com'];

export function analyticsAllowed(
  hostname: string,
  doNotTrack: string | null,
  globalPrivacyControl?: boolean,
) {
  return (
    hostname === 'wya.im' && doNotTrack !== '1' && doNotTrack !== 'yes' && !globalPrivacyControl
  );
}

export type AnalyticsScope = { path: string; spaceKey?: string; itemIds?: string[] };
/** Only explicit public events survive; no destinations, labels or visitor identity. */
export function sanitizePublicEvent(
  event: CaptureResult | null,
  scope: AnalyticsScope | null,
): CaptureResult | null {
  if (!event || !scope || !['$pageview', 'wya_item_click'].includes(event.event)) return null;
  const { path, spaceKey } = scope;
  const itemId = event.properties.wya_item_id;
  if (
    event.event === 'wya_item_click' &&
    (!spaceKey || typeof itemId !== 'string' || !scope.itemIds?.includes(itemId))
  )
    return null;
  const properties: Record<string, unknown> = {};
  for (const key of ['token', 'distinct_id', '$cookieless_mode', '$lib', '$lib_version']) {
    if (event.properties[key] !== undefined) properties[key] = event.properties[key];
  }
  return {
    uuid: event.uuid,
    event: event.event,
    timestamp: event.timestamp,
    properties: {
      ...properties,
      $process_person_profile: false,
      $current_url: `https://wya.im${path}`,
      $host: 'wya.im',
      $pathname: path,
      page_kind: path === '/' ? 'home' : 'profile',
      ...(spaceKey ? { wya_space_id: spaceKey } : {}),
      ...(event.event === 'wya_item_click' ? { wya_item_id: itemId } : {}),
    },
  };
}

export function sanitizePageview(event: CaptureResult | null, path: string | null) {
  return event?.event === '$pageview' ? sanitizePublicEvent(event, path ? { path } : null) : null;
}

export const privateAnalyticsConfig: Partial<PostHogConfig> = {
  cookieless_mode: 'always',
  person_profiles: 'never',
  persistence: 'memory',
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  capture_dead_clicks: false,
  capture_exceptions: false,
  capture_performance: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_external_dependency_loading: true,
  advanced_disable_flags: true,
  save_referrer: false,
  save_campaign_params: false,
  respect_dnt: true,
};
