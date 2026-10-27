import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readDesktopDrag,
  desktopAppId,
  desktopItem,
  desktopShortcutLabel,
  orderedDesktopItems,
  moveDesktopItem,
} from '../lib/desktop-items.ts';
import { actionSchema } from '../lib/profile-action-schema.ts';
import { applyAction } from '../lib/profile-actions.ts';

test('Home can hide document extensions without changing dotted folder and app labels', () => {
  assert.equal(desktopShortcutLabel('file-notes', 'notes.v2.md', false), 'notes.v2');
  assert.equal(desktopShortcutLabel('file-notes', 'notes.TXT', false), 'notes');
  assert.equal(desktopShortcutLabel('file-games', 'Games.MD', false), 'Games');
  assert.equal(desktopShortcutLabel('file-chat', 'Community.WIDGET', false), 'Community');
  assert.equal(desktopShortcutLabel('file-chat', 'Community.widget', true), 'Community.widget');
  assert.equal(desktopShortcutLabel('file-games', 'Games', false), 'Games');
  for (const name of ['.md', 'notes.pdf', 'readme'])
    assert.equal(desktopShortcutLabel('file-notes', name, false), name);
  assert.equal(desktopShortcutLabel('folder-notes', 'archive.md', false), 'archive.md');
  assert.equal(desktopShortcutLabel('app-notes', 'notes.txt', false), 'notes.txt');
  assert.equal(desktopShortcutLabel('file-notes', 'notes.md', true), 'notes.md');
});

test('desktop drops are scoped to one space and recognized item types', () => {
  const payload = JSON.stringify({ kind: 'file', id: 'home', spaceId: 'one' });
  assert.deepEqual(readDesktopDrag(payload, 'one'), { kind: 'file', id: 'home' });
  assert.equal(readDesktopDrag(payload, 'two'), null);
  for (const value of [
    'broken',
    'null',
    '{}',
    JSON.stringify({ spaceId: 'one', kind: 'script', id: 'x' }),
    JSON.stringify({ spaceId: 'one', kind: 'file', id: '../private' }),
  ])
    assert.equal(readDesktopDrag(value, 'one'), null);
  assert.equal(desktopAppId(desktopItem('file-home')), 'file-home');
  assert.equal(desktopAppId(desktopItem('file-example')), 'file-example');
  assert.deepEqual(desktopItem('folder-example'), { kind: 'folder', id: 'example' });
  assert.equal(desktopAppId(desktopItem('folder-example')), 'folder-example');
});
test('shortcut moves work in either direction and retain newly added icons', () => {
  const ids = ['about', 'file-home', 'files'];
  assert.deepEqual(moveDesktopItem(ids, 'about', 'file-home'), ['file-home', 'about', 'files']);
  assert.deepEqual(moveDesktopItem(ids, 'files', 'about'), ['files', 'about', 'file-home']);
  assert.equal(moveDesktopItem(ids, 'missing', 'files'), ids);
  assert.deepEqual(
    orderedDesktopItems(
      ids.map((id) => ({ id })),
      ['gone', 'files', 'about'],
    ).map((item) => item.id),
    ['files', 'about', 'file-home'],
  );
});
test('desktop ordering is bounded, saved without changing file content and rejects duplicate IDs', () => {
  const input = {
    action: 'update_profile',
    expectedVersion: 1,
    desktopOrder: ['files', 'file-home', 'about'],
  };
  const action = actionSchema.parse(input);
  const profile = { name: 'Alice', bio: '', theme: 'lilac' as const, links: [] };
  const saved = applyAction(profile, action).data;
  assert.deepEqual(saved.desktopOrder, input.desktopOrder);
  assert.deepEqual(saved.links, profile.links);
  assert.equal(saved.files, undefined);
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
