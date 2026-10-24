import test from 'node:test';
import assert from 'node:assert/strict';
import { isRenameShortcut, type RenameShortcut } from '../lib/desktop-preferences.ts';

const enter = {
  key: 'Enter',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

test('rename uses exactly the configured Enter or F2 shortcut', () => {
  assert.equal(isRenameShortcut(enter, 'Enter'), true);
  assert.equal(isRenameShortcut(enter, 'F2'), false);
  assert.equal(isRenameShortcut({ ...enter, key: 'F2' }, 'F2'), true);
  assert.equal(isRenameShortcut({ ...enter, key: 'F2' }, 'Enter'), false);
  assert.equal(isRenameShortcut({ ...enter, key: 'Escape' }, 'Enter'), false);
});

test('rename does not consume modified keys, composition confirmation, or held keys', () => {
  for (const shortcut of ['Enter', 'F2'] satisfies RenameShortcut[]) {
    for (const flag of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing', 'repeat']) {
      assert.equal(
        isRenameShortcut({ ...enter, key: shortcut, [flag]: true }, shortcut),
        false,
        `${shortcut} with ${flag} must not start renaming`,
      );
    }
  }
});
