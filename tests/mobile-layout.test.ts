import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMobileLayout, resolveMobileFiles } from '../lib/mobile-layout.ts';
import { actionSchema } from '../lib/profile-action-schema.ts';
import { applyAction } from '../lib/profile-actions.ts';
import { visibleProfile } from '../lib/public-profile.ts';
import { canonicalProfileData } from '../lib/markdown-file-store.ts';
import type { Profile, ProfileData } from '../lib/profile-types.ts';
import type { SpaceFile } from '../lib/space-files.ts';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const privateId = '33333333-3333-4333-8333-333333333333';
const missingId = '44444444-4444-4444-8444-444444444444';
const file = (id: string, extra: Partial<SpaceFile> = {}): SpaceFile => ({
  id,
  name: 'Hello.md',
  content: '# Hello',
  folderId: null,
  size: 7,
  version: 1,
  published: true,
  hasChanges: false,
  pinned: true,
  updatedAt: '2026-10-29',
  ...extra,
});
const data: ProfileData = {
  name: 'Alex',
  bio: '',
  theme: 'lilac',
  links: [],
  files: [
    file(firstId, { position: 2 }),
    file(secondId, { position: 1 }),
    file(privateId, { published: false }),
  ],
  defaultFileId: firstId,
  desktopOrder: [`file-${firstId}`, 'files'],
  mainWindowId: 'about',
};
const update = (mobileLayout: unknown) =>
  actionSchema.parse({
    action: 'update_profile',
    expectedVersion: 1,
    mobileLayout,
  });
const ids = (profile: Parameters<typeof resolveMobileFiles>[0]) =>
  resolveMobileFiles(profile).map((entry) => entry.id);

test('mobile selection validates unique file IDs, explicit empty and reset', () => {
  for (const mobileLayout of [{ fileIds: [secondId, firstId] }, { fileIds: [] }, null])
    assert.doesNotThrow(() => update(mobileLayout));
  for (const mobileLayout of [
    { fileIds: [firstId, firstId] },
    { fileIds: ['about'] },
    { fileIds: [1] },
    { fileIds: [], extra: true },
    { fileIds: 'all' },
    [],
    'all',
    {},
  ])
    assert.throws(() => update(mobileLayout));
  assert.throws(() => update({ fileIds: Array.from({ length: 31 }, () => crypto.randomUUID()) }));
});

test('mobile selection is independent of desktop order and only accepts usable published files from the space', () => {
  const changed = applyAction(data, update({ fileIds: [secondId, firstId] })).data;
  assert.deepEqual(changed.mobileLayout, { fileIds: [secondId, firstId] });
  assert.deepEqual(changed.desktopOrder, data.desktopOrder);
  assert.equal(changed.mainWindowId, data.mainWindowId);
  assert.equal(changed.defaultFileId, data.defaultFileId);
  assert.equal(data.mobileLayout, undefined);
  assert.deepEqual(applyAction(changed, update({ fileIds: [] })).data.mobileLayout, {
    fileIds: [],
  });
  assert.equal(applyAction(changed, update(null)).data.mobileLayout, undefined);
  for (const id of [privateId, missingId])
    assert.throws(
      () => applyAction(data, update({ fileIds: [id] })),
      /published files from this space/,
    );
  for (const invalid of [
    file(firstId, { name: 'Invalid.widget', content: '# Not a widget' }),
    file(firstId, { hasChanges: true }),
  ])
    assert.throws(() => applyAction({ ...data, files: [invalid] }, update({ fileIds: [firstId] })));
});

test('automatic mobile order uses Main file then default and stable navigation; explicit order is authoritative', () => {
  assert.deepEqual(ids(data), [firstId, secondId]);
  assert.deepEqual(ids({ ...data, mainWindowId: `file-${secondId}` }), [secondId, firstId]);
  assert.deepEqual(ids({ ...data, defaultFileId: missingId }), [secondId, firstId]);
  assert.deepEqual(ids({ ...data, mobileLayout: { fileIds: [secondId] } }), [secondId]);
  assert.deepEqual(ids({ ...data, mobileLayout: { fileIds: [] } }), []);
  assert.deepEqual(ids({ ...data, mobileLayout: { fileIds: [missingId, privateId] } }), []);
  assert.deepEqual(ids({}), []);
});

test('mobile rendering uses the published snapshot instead of pending private edits', () => {
  const current = file(firstId, {
    hasChanges: true,
    content: '# Private draft',
    name: 'Private.md',
    publishedContent: '# Public',
    publishedName: 'Public.md',
    appearance: { bodyFont: 'mono' },
    publishedAppearance: { bodyFont: 'serif' },
  });
  const [resolved] = resolveMobileFiles({ files: [current], mobileLayout: { fileIds: [firstId] } });
  assert.equal(resolved.name, 'Public.md');
  assert.match(resolved.content, /# Public/);
  assert.doesNotMatch(resolved.content, /Private/);
  assert.deepEqual(resolved.appearance, { bodyFont: 'serif' });
  assert.equal(current.content, '# Private draft');
});

test('canonical and public projections prune inaccessible mobile IDs without reverting to automatic', () => {
  const profile: Profile = {
    ...data,
    id: 'space',
    handle: 'alex',
    aliases: [],
    version: 1,
    updatedAt: '2026-10-29',
    mobileLayout: { fileIds: [secondId, privateId, missingId, firstId, secondId] },
  };
  assert.deepEqual(normalizeMobileLayout(profile.mobileLayout, data.files!), {
    fileIds: [secondId, firstId],
  });
  assert.deepEqual(canonicalProfileData(profile, data.files!).mobileLayout, {
    fileIds: [secondId, firstId],
  });
  assert.deepEqual(visibleProfile(profile).mobileLayout, { fileIds: [secondId, firstId] });
  const unavailable = { ...profile, files: [file(privateId, { published: false })] };
  assert.deepEqual(canonicalProfileData(unavailable, unavailable.files).mobileLayout, {
    fileIds: [],
  });
  assert.deepEqual(visibleProfile(unavailable).mobileLayout, { fileIds: [] });
  const malformed = {
    ...profile,
    files: [file(firstId, { name: 'Invalid.widget', content: '# Invalid' })],
  };
  assert.deepEqual(visibleProfile(malformed).mobileLayout, { fileIds: [] });
  assert.equal(
    visibleProfile({ ...profile, files: undefined, fileModelVersion: 1 }).mobileLayout,
    undefined,
  );
  assert.equal(normalizeMobileLayout(undefined, data.files!), undefined);
});

test('all-screen column choice persists through actions, canonical storage and public projection', () => {
  const layout = { fileIds: [secondId, firstId], screens: 'all' as const };
  const changed = applyAction(data, update(layout)).data;
  assert.deepEqual(changed.mobileLayout, layout);
  assert.deepEqual(canonicalProfileData(changed, data.files!).mobileLayout, layout);
  const profile = {
    ...changed,
    id: 'space',
    handle: 'alex',
    aliases: [],
    version: 1,
    updatedAt: '2026-10-29',
  };
  assert.deepEqual(visibleProfile(profile).mobileLayout, layout);
  assert.deepEqual(normalizeMobileLayout(layout, []), { fileIds: [], screens: 'all' });
  assert.deepEqual(ids(changed), [secondId, firstId]);
  const mobile = applyAction(changed, update({ fileIds: [secondId], screens: 'mobile' })).data;
  assert.equal(mobile.mobileLayout?.screens, 'mobile');
  assert.notEqual(visibleProfile({ ...profile, ...mobile }).mobileLayout?.screens, 'all');
  assert.throws(() => update({ ...layout, screens: 'desktop' }));
});
