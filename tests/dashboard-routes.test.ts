import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dashboardHref,
  dashboardInitialHref,
  dashboardSections,
  parseDashboardRoute,
} from '../lib/dashboard-routes.ts';

const parse = (path: string) => parseDashboardRoute(new URL(path, 'https://wya.im'));

test('initial billing URLs retain only recognized checkout returns alongside the resolved space', () => {
  for (const checkout of ['success', 'cancel']) {
    assert.equal(
      dashboardInitialHref(
        { section: 'billing', spaceId: 'space/one' },
        new URL(`https://wya.im/dashboard/billing?checkout=${checkout}&untrusted=discard`),
      ),
      `/dashboard/billing?space=space%2Fone&checkout=${checkout}`,
    );
  }
  assert.equal(
    dashboardInitialHref(
      { section: 'billing' },
      new URL('https://wya.im/dashboard/billing?checkout=success'),
    ),
    '/dashboard/billing?checkout=success',
  );
  for (const path of [
    '/dashboard/billing?checkout=premium',
    '/dashboard/billing?customer=cus_untrusted',
    '/dashboard/links?checkout=success',
    '/elsewhere?checkout=success',
  ]) {
    assert.equal(
      dashboardInitialHref({ section: 'billing' }, new URL(path, 'https://wya.im')),
      '/dashboard/billing',
    );
  }
  assert.equal(
    dashboardInitialHref(
      { section: 'profile' },
      new URL('https://wya.im/dashboard/billing?checkout=success'),
    ),
    '/dashboard/profile',
  );
});

test('dashboard links round-trip every section and encode the selected space', () => {
  for (const section of dashboardSections) {
    const spaceId = 'space/with ?reserved&characters';
    const href = dashboardHref(section, spaceId);
    assert.deepEqual(parse(href), { section, spaceId });
    assert.equal(new URL(href, 'https://wya.im').searchParams.size, 1);
    assert.deepEqual(parse(dashboardHref(section)), {
      section,
      spaceId: undefined,
    });
  }
});

test('unknown sections and other paths are not intercepted as dashboard navigation', () => {
  for (const path of [
    '/dashboard/nope',
    '/dashboard/profile/extra',
    '/dashboard/links',
    '/experimental-dashboard/files',
    '/dashboard/chatgpt',
    '/dashboardish/profile',
    '/another/profile',
    '/connections',
    '/sign-out',
  ])
    assert.equal(parse(path), null, path);
});
