'use client';

import { useEffect } from 'react';
import type { PostHog } from 'posthog-js';
import {
  analyticsAllowed,
  posthogHosts,
  privateAnalyticsConfig,
  sanitizePublicEvent,
  type AnalyticsScope,
} from '@/lib/public-analytics';

let client: Promise<PostHog> | undefined;
let activePage: AnalyticsScope | null = null;

export function PublicAnalyticsClient({
  token,
  host,
  path,
  spaceKey,
  items = '[]',
  customHostname,
}: {
  token: string;
  host: string;
  path: string;
  spaceKey?: string;
  items?: string;
  customHostname?: string;
}) {
  useEffect(() => {
    const privacyNavigator = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (
      !analyticsAllowed(
        window.location.hostname,
        navigator.doNotTrack,
        privacyNavigator.globalPrivacyControl,
        customHostname,
      ) ||
      !/^phc_[A-Za-z0-9_-]+$/.test(token) ||
      !posthogHosts.includes(host)
    )
      return;
    const page = { path, spaceKey, itemIds: JSON.parse(items) as string[] };
    activePage = page;
    client ??= import('posthog-js')
      .then(({ default: posthog }) => {
        posthog.init(token, {
          ...privateAnalyticsConfig,
          api_host: host,
          before_send: (event) => sanitizePublicEvent(event, activePage),
        });
        return posthog;
      })
      .catch((error) => {
        client = undefined;
        throw error;
      });
    void client
      .then((posthog) => {
        // Ignore loads completed after navigation and React's discarded effect pass.
        if (activePage === page) posthog.capture('$pageview');
      })
      .catch(() => {
        /* Analytics failure must never affect the page. */
      });
    function captureClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0)
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]');
      const itemId = anchor?.closest<HTMLElement>('[data-analytics-item]')?.dataset.analyticsItem;
      if (!itemId || !page.itemIds.includes(itemId)) return;
      void client
        ?.then((posthog) => {
          if (activePage === page) posthog.capture('wya_item_click', { wya_item_id: itemId });
        })
        .catch(() => {});
    }
    document.addEventListener('click', captureClick);
    document.addEventListener('auxclick', captureClick);
    return () => {
      document.removeEventListener('click', captureClick);
      document.removeEventListener('auxclick', captureClick);
      if (activePage === page) activePage = null;
    };
  }, [token, host, path, spaceKey, items, customHostname]);
  return null;
}
