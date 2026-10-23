import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHref, dashboardSections, parseDashboardRoute } from '../lib/dashboard-routes.ts';

const parse = (path: string) => parseDashboardRoute(new URL(path, 'https://wya.im'));

test('experimental routes stay separate from classic dashboard navigation', () => {
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
