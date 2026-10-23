import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleProfile } from '../lib/public-profile.ts';
import { getProfileLayout } from '../lib/profile-tabs.ts';
import { initialWindows, windowReducer } from '../app/components/desktop-profile/window-state.ts';
import type { Profile, LinkItem } from '../lib/profile-types.ts';

const link = (slug: string, visible = true): LinkItem => ({
  slug,
  label: slug,
  platform: 'website',
  url: 'https://example.com',
  visible,
});

test('visitor view excludes hidden tabs, items and collection children without mutating owner data', () => {
  const profile: Profile = {
    id: 'space',
    handle: 'alex',
    aliases: [],
    version: 1,
    updatedAt: '',
    name: 'Alex',
    bio: '',
    theme: 'lilac',
    defaultTabId: 'private',
    tabs: [
      {
        id: 'home',
        slug: 'home',
        title: 'Home',
        sections: [],
        ungrouped: ['public', 'hidden', 'games'],
      },
      {
        id: 'private',
        slug: 'private',
        title: 'Private',
        hidden: true,
        sections: [],
        ungrouped: ['private-link'],
      },
    ],
    links: [
      link('public'),
      link('hidden', false),
      link('private-link'),
      {
        ...link('games'),
        kind: 'collection',
        collection: { type: 'game', items: [link('visible-game'), link('hidden-game', false)] },
      },
    ],
  };
  const original = structuredClone(profile);
  const result = visibleProfile(profile);
  assert.deepEqual(
    result.tabs?.map((tab) => tab.id),
    ['home'],
  );
  assert.equal(result.defaultTabId, 'home');
  assert.deepEqual(
    result.links.map((item) => item.slug),
    ['public', 'games'],
  );
  assert.deepEqual(
    result.links[1].collection?.items.map((item) => item.slug),
    ['visible-game'],
  );
  assert.deepEqual(getProfileLayout(result).tabs[0].ungrouped, ['public', 'games']);
  assert.deepEqual(profile, original);
  assert.deepEqual(visibleProfile(result), result);
});

test('resetting the visitor desktop retains mounted owner drafts but hides management windows', () => {
  let state = windowReducer(initialWindows('tab-home', 'about'), {
    type: 'open',
    id: 'owner-profile',
  });
  state = windowReducer(state, {
    type: 'reset',
    firstTab: 'tab-home',
    active: 'about',
    preserve: ['owner-profile'],
  });
  assert.ok(state.loaded.includes('owner-profile'));
  assert.deepEqual(state.order, ['tab-home', 'about']);
  assert.ok(!state.running.includes('owner-profile'));
});
