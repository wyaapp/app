import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskbarItems } from '../app/components/desktop-profile/taskbar-items.ts';
import { windowReducer } from '../app/components/desktop-profile/window-state.ts';

const entries = ['paint', 'files', 'file-notes', 'tab-links', 'folder-projects'].map((id) => ({
  id,
}));
const ids = (items: typeof entries) => items.map((item) => item.id);

test('closed pins remain, minimized apps remain, and closing an unpinned app removes it', () => {
  let windows = {
    loaded: ['paint', 'files'],
    running: ['paint', 'files'],
    order: ['paint', 'files'],
    maximized: [] as string[],
  };
  windows = windowReducer(windows, { type: 'hide', id: 'paint' });
  assert.deepEqual(ids(taskbarItems(entries, ['file-notes'], windows.running)), [
    'file-notes',
    'paint',
    'files',
  ]);
  windows = windowReducer(windows, { type: 'close', id: 'paint' });
  assert.deepEqual(ids(taskbarItems(entries, ['file-notes'], windows.running)), [
    'file-notes',
    'files',
  ]);
  windows = windowReducer(windows, { type: 'close', id: 'files' });
  assert.deepEqual(ids(taskbarItems(entries, ['files', 'file-notes'], windows.running)), [
    'files',
    'file-notes',
  ]);
});

test('pins deduplicate running apps and support folders, tabs, and files', () => {
  assert.deepEqual(
    ids(
      taskbarItems(
        entries,
        ['folder-projects', 'tab-links', 'paint', 'file-notes', 'paint'],
        ['paint', 'files'],
      ),
    ),
    ['folder-projects', 'tab-links', 'paint', 'file-notes', 'files'],
  );
  assert.deepEqual(ids(taskbarItems(entries, [], ['paint', 'files'])), ['paint', 'files']);
});

test('deleted and inaccessible items never appear in the taskbar', () => {
  assert.deepEqual(
    ids(taskbarItems(entries, ['deleted', 'owner-settings', 'paint'], ['private-file', 'files'])),
    ['paint', 'files'],
  );
});
