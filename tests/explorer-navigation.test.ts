import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedFolderNavigation } from '../lib/explorer-navigation.ts';
import { navigateFolder } from '../lib/desktop-entries.ts';

test('folder shortcut requests wait for loaded data and pending operations', () => {
  const history = { locations: [null], index: 0 };
  const request = { id: 'desktop', sequence: 1 };
  assert.equal(requestedFolderNavigation(history, null, request, [], true), null);
  const result = requestedFolderNavigation(history, null, request, [{ id: 'desktop' }], false)!;
  assert.equal(result.found, true);
  assert.deepEqual(result.history.locations, [null, 'desktop']);
  assert.equal(result.history.index, 1);
});

test('unchanged request does not reopen a folder after user navigation, while a new request does', () => {
  const history = { locations: [null], index: 0 };
  const folders = [{ id: 'desktop' }, { id: 'notes' }];
  const request = { id: 'desktop', sequence: 1 };
  const first = requestedFolderNavigation(history, null, request, folders, false)!;
  const navigated = navigateFolder(first.history, 'notes');
  assert.equal(requestedFolderNavigation(navigated, first.key, request, folders, false), null);
  const second = requestedFolderNavigation(
    navigated,
    first.key,
    { ...request, sequence: 2 },
    folders,
    false,
  )!;
  assert.equal(second.history.locations[second.history.index], 'desktop');
  // The caller clears acknowledged requests, so a remounted Files app also stays put.
  assert.equal(requestedFolderNavigation(navigated, null, undefined, folders, false), null);
});

test('missing or inaccessible folder is consumed without changing the current directory', () => {
  const history = { locations: ['visible'], index: 0 };
  const request = { id: 'hidden', sequence: 1 };
  const result = requestedFolderNavigation(history, null, request, [{ id: 'visible' }], false)!;
  assert.equal(result.found, false);
  assert.equal(result.history, history);
  assert.equal(requestedFolderNavigation(history, result.key, request, [], false), null);
});
