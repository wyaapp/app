import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAIN_WINDOW_APP_IDS,
  isMainWindowId,
  normalizeMainWindowId,
  resolveMainWindowId,
} from '../lib/main-window.ts';
import { actionSchema } from '../lib/profile-action-schema.ts';
import { applyAction } from '../lib/profile-actions.ts';
import { visibleProfile } from '../lib/public-profile.ts';
import { canonicalProfileData } from '../lib/markdown-file-store.ts';
import type { Profile, ProfileData } from '../lib/profile-types.ts';
import type { SpaceFile } from '../lib/space-files.ts';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const file = (id: string, extra: Partial<SpaceFile> = {}): SpaceFile => ({
  id,
  name: 'Main.md',
  content: '# Hello',
  folderId: null,
  size: 7,
  version: 1,
  published: true,
  hasChanges: false,
  pinned: true,
  updatedAt: '2026-10-28',
  ...extra,
});
const data: ProfileData = {
  name: 'Alex',
  bio: '',
  theme: 'lilac',
  links: [],
  files: [file(firstId), file(secondId)],
};

test('Main window choices reject private apps and arbitrary targets', () => {
  for (const id of [...MAIN_WINDOW_APP_IDS, `file-${firstId}`]) {
    assert.equal(isMainWindowId(id), true);
    assert.equal(normalizeMainWindowId(id, data.files!), id);
    assert.doesNotThrow(() =>
      actionSchema.parse({ action: 'update_profile', expectedVersion: 1, mainWindowId: id }),
    );
  }
  for (const id of ['billing', 'settings', 'appearance', 'feedback', 'file-not-a-uuid', '', null]) {
    assert.equal(isMainWindowId(id), false);
    assert.equal(normalizeMainWindowId(id, data.files!), undefined);
    if (id !== null) {
      assert.throws(() =>
        actionSchema.parse({ action: 'update_profile', expectedVersion: 1, mainWindowId: id }),
      );
    }
  }
  assert.equal(normalizeMainWindowId(`file-${secondId}`, [file(firstId)]), undefined);
  assert.equal(
    normalizeMainWindowId(`file-${firstId}`, [file(firstId, { published: false })]),
    undefined,
  );
});

test('Main resolves before default, with stable published-file and Bio fallbacks', () => {
  const profile = {
    files: [file(firstId, { position: 2 }), file(secondId, { position: 1 })],
    defaultFileId: firstId,
    mainWindowId: `file-${secondId}`,
  };
  assert.equal(resolveMainWindowId(profile), `file-${secondId}`);
  assert.equal(resolveMainWindowId({ ...profile, mainWindowId: 'about' }), 'about');
  assert.equal(resolveMainWindowId({ ...profile, mainWindowId: 'billing' }), `file-${firstId}`);
  assert.equal(
    resolveMainWindowId({
      ...profile,
      files: [file(firstId), file(secondId, { published: false })],
    }),
    `file-${firstId}`,
  );
  assert.equal(
    resolveMainWindowId({ ...profile, mainWindowId: undefined, defaultFileId: 'missing' }),
    `file-${secondId}`,
  );
  assert.equal(
    resolveMainWindowId({
      mainWindowId: `file-${firstId}`,
      files: [file(firstId, { published: false })],
    }),
    'about',
  );
  assert.equal(resolveMainWindowId({}), 'about');
  assert.deepEqual(
    profile.files.map((entry) => entry.id),
    [firstId, secondId],
  );
});

test('Main is explicit metadata, not a replacement for the default document', () => {
  const before = { ...data, defaultFileId: firstId };
  const update = (mainWindowId: string | null) =>
    actionSchema.parse({ action: 'update_profile', expectedVersion: 1, mainWindowId });
  const changed = applyAction(before, update(`file-${secondId}`)).data;
  assert.equal(changed.mainWindowId, `file-${secondId}`);
  assert.equal(changed.defaultFileId, firstId);
  assert.equal(before.mainWindowId, undefined);
  assert.equal(canonicalProfileData(changed, data.files!).mainWindowId, `file-${secondId}`);
  assert.equal(applyAction(changed, update(null)).data.mainWindowId, undefined);
  assert.equal(canonicalProfileData(changed, [file(firstId)]).mainWindowId, undefined);
  assert.throws(() => applyAction({ ...data, files: [] }, update(`file-${secondId}`)));
  assert.throws(() =>
    applyAction(
      { ...data, files: [file(secondId, { published: false })] },
      update(`file-${secondId}`),
    ),
  );
});

test('public Main selection never points at a private or malformed file snapshot', () => {
  const profile: Profile = {
    ...data,
    id: 'space',
    handle: 'alex',
    aliases: [],
    version: 1,
    updatedAt: '2026-10-28',
    mainWindowId: `file-${firstId}`,
    files: [file(firstId, { name: 'Invalid.widget', content: '# Not a widget' }), file(secondId)],
  };
  const visible = visibleProfile(profile);
  assert.equal(visible.mainWindowId, undefined);
  assert.equal(resolveMainWindowId(visible), `file-${secondId}`);
  const update = actionSchema.parse({
    action: 'update_profile',
    expectedVersion: 1,
    mainWindowId: `file-${firstId}`,
  });
  assert.throws(() => applyAction(profile, update));
});
