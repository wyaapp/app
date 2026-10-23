import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readDesktopDrag,
  desktopAppId,
  desktopItem,
  orderedDesktopItems,
  moveDesktopItem,
} from '../lib/desktop-items.ts';
import { actionSchema } from '../lib/profile-action-schema.ts';
import { applyAction } from '../lib/profile-actions.ts';

test('desktop drops are scoped to one space and recognized item types', () => {
  const payload = JSON.stringify({ kind: 'page', id: 'home', spaceId: 'one' });
  assert.deepEqual(readDesktopDrag(payload, 'one'), { kind: 'page', id: 'home' });
  assert.equal(readDesktopDrag(payload, 'two'), null);
  for (const value of [
    'broken',
    'null',
    '{}',
    JSON.stringify({ spaceId: 'one', kind: 'script', id: 'x' }),
    JSON.stringify({ spaceId: 'one', kind: 'file', id: '../private' }),
  ])
    assert.equal(readDesktopDrag(value, 'one'), null);
  assert.equal(desktopAppId(desktopItem('tab-home')), 'tab-home');
  assert.equal(desktopAppId(desktopItem('file-example')), 'file-example');
  assert.deepEqual(desktopItem('folder-example'), { kind: 'folder', id: 'example' });
  assert.equal(desktopAppId(desktopItem('folder-example')), 'folder-example');
});
test('shortcut moves work in either direction and retain newly added icons', () => {
  const ids = ['about', 'tab-home', 'files'];
  assert.deepEqual(moveDesktopItem(ids, 'about', 'tab-home'), ['tab-home', 'about', 'files']);
  assert.deepEqual(moveDesktopItem(ids, 'files', 'about'), ['files', 'about', 'tab-home']);
  assert.equal(moveDesktopItem(ids, 'missing', 'files'), ids);
  assert.deepEqual(
    orderedDesktopItems(
      ids.map((id) => ({ id })),
      ['gone', 'files', 'about'],
    ).map((item) => item.id),
    ['files', 'about', 'tab-home'],
  );
});
test('desktop ordering is bounded, saved without changing tabs and rejects duplicate IDs', () => {
  const input = {
    action: 'update_profile',
    expectedVersion: 1,
    desktopOrder: ['files', 'tab-home', 'about'],
  };
  const action = actionSchema.parse(input);
  const profile = { name: 'Alice', bio: '', theme: 'lilac' as const, links: [] };
  const saved = applyAction(profile, action).data;
  assert.deepEqual(saved.desktopOrder, input.desktopOrder);
  assert.deepEqual(saved.links, profile.links);
  assert.equal(saved.tabs, undefined);
  assert.equal(
    actionSchema.safeParse({ ...input, desktopOrder: ['files', 'files'] }).success,
    false,
  );
  assert.equal(
    actionSchema.safeParse({
      ...input,
      desktopOrder: Array.from({ length: 101 }, (_, i) => `app-${i}`),
    }).success,
    false,
  );
});
