import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dashboardHref,
  dashboardInitialHref,
  dashboardSections,
  dashboardWindowId,
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

test('Help and old ChatGPT bookmarks share one window while retaining their guide route', () => {
  assert.deepEqual(parse('/dashboard/help?space=work'), { section: 'help', spaceId: 'work' });
  assert.deepEqual(parse('/dashboard/chatgpt?space=work'), { section: 'chatgpt', spaceId: 'work' });
  assert.equal(dashboardWindowId('help'), 'owner-help');
  assert.equal(dashboardWindowId('chatgpt'), 'owner-help');
  assert.equal(dashboardWindowId('links'), 'owner-links');
});

test('legacy experimental paths can be recognized without intercepting canonical navigation', () => {
  const base = '/experimental-dashboard';
  for (const section of dashboardSections) {
    const href = dashboardHref(section, 'space/one', base);
    assert.deepEqual(parseDashboardRoute(new URL(href, 'https://wya.im'), base), {
      section,
      spaceId: 'space/one',
    });
    assert.equal(parse(href), null);
    assert.equal(
      parseDashboardRoute(new URL(dashboardHref(section), 'https://wya.im'), base),
      null,
    );
  }
  assert.deepEqual(
    parseDashboardRoute(
      new URL('https://wya.im/experimental-dashboard?tab=domains&space=work'),
      base,
    ),
    { section: 'domains', spaceId: 'work' },
  );
  for (const path of [
    '/experimental-dashboardish/links',
    '/experimental-dashboard/nope',
    '/experimental-dashboard/profile/extra',
  ])
    assert.equal(parseDashboardRoute(new URL(path, 'https://wya.im'), base), null);
});

test('dashboard links round-trip every section and encode the selected space', () => {
  for (const section of dashboardSections) {
    const spaceId = 'space/with ?reserved&characters';
    const href = dashboardHref(section, spaceId);
    assert.deepEqual(parse(href), { section, spaceId });
    assert.equal(new URL(href, 'https://wya.im').searchParams.size, 1);
    assert.deepEqual(parse(dashboardHref(section)), { section, spaceId: undefined });
  }
});

test('old dashboard bookmarks retain their section and space', () => {
  assert.deepEqual(parse('/dashboard'), { section: 'links', spaceId: undefined });
  assert.deepEqual(parse('/dashboard?space=work&tab=profile'), {
    section: 'profile',
    spaceId: 'work',
  });
  assert.deepEqual(parse('/dashboard/history/?space=work&tab=profile'), {
    section: 'history',
    spaceId: 'work',
  });
});

test('unknown sections and other paths are not intercepted as dashboard navigation', () => {
  for (const path of [
    '/dashboard/nope',
    '/dashboard/profile/extra',
    '/dashboard?tab=nope',
    '/dashboardish/profile',
    '/another/profile',
    '/connections',
    '/sign-out',
  ])
    assert.equal(parse(path), null, path);
});
