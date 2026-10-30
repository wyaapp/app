import { fileNavigationOrder, applyFileOrderPatch } from '../lib/file-navigation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverLegacyFileDraft } from '../lib/file-draft-recovery.ts';
import { serializePageDraft } from '../lib/page-draft.ts';
import { normalizeDocumentAppearance } from '../lib/document-appearance.ts';
import type { SpaceFile } from '../lib/space-files.ts';

const file: SpaceFile = {
  id: 'migrated-socials',
  legacyTabId: 'socials',
  name: 'socials.md',
  content: '# Published',
  position: 1,
  size: 11,
  version: 1,
  published: true,
  hasChanges: false,
  pinned: true,
  folderId: 'desktop',
  updatedAt: '2026-10-27',
};
test('legacy Markdown and appearance drafts are recoverable without altering publication', () => {
  const appearance = normalizeDocumentAppearance(undefined);
  const raw = serializePageDraft({
    base: { source: '# Published', appearance },
    value: { source: '# Private changes', appearance: { ...appearance, theme: 'black' } },
  });
  const result = recoverLegacyFileDraft(raw, file)!;
  assert.equal(result.content, '# Private changes');
  assert.equal(result.appearance.theme, 'black');
  assert.equal(result.conflict, false);
  assert.equal(file.content, '# Published');
  assert.equal(file.published, true);
  assert.equal(
    recoverLegacyFileDraft(raw, { ...file, content: '# Changed elsewhere' })!.conflict,
    true,
  );
  assert.equal(recoverLegacyFileDraft('invalid json', file), null);
  assert.equal(recoverLegacyFileDraft(raw, { ...file, legacyTabId: undefined }), null);
});

test('already saved recovery is not offered again and source-only drafts retain appearance', () => {
  const raw = JSON.stringify({ version: 1, source: '# Draft', baseSource: '# Published' });
  assert.equal(recoverLegacyFileDraft(raw, { ...file, content: '# Draft' }), null);
  assert.deepEqual(
    recoverLegacyFileDraft(raw, { ...file, appearance: { theme: 'dim' } })!.appearance,
    normalizeDocumentAppearance({ theme: 'dim' }),
  );
});

test('navigation rank is stable and order patches rebase only matching versions without touching drafts', () => {
  const original = { ...file, version: 5, content: '# Private source', position: 1000 };
  const earlier = { ...file, id: 'aaa', position: 0 };
  assert.deepEqual(
    fileNavigationOrder([original, earlier]).map((item) => item.id),
    ['aaa', original.id],
  );
  const patch = {
    id: original.id,
    previousVersion: 5,
    version: 6,
    position: 0,
    updatedAt: 'later',
  };
  const next = applyFileOrderPatch(original, [patch]);
  assert.equal(next.content, '# Private source');
  assert.equal(next.version, 6);
  assert.equal(next.position, 0);
  assert.equal(applyFileOrderPatch({ ...original, version: 7 }, [patch]).version, 7);
  assert.equal(original.version, 5);
});
