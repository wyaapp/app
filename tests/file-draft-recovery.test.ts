import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fileDraftStorageKey,
  recoverFileDraft,
  serializeFileDraft,
  type FileDraftValue,
} from '../lib/file-draft-recovery.ts';
import { MAX_FILE_BYTES, type SpaceFile } from '../lib/space-files.ts';

const file: SpaceFile = {
  id: 'bcb5c8b5-0d87-4765-84ac-13ea80e68695',
  name: 'Socials.md',
  content: '# Saved\n',
  appearance: {},
  folderId: null,
  version: 3,
  size: 8,
  pinned: false,
  published: true,
  hasChanges: false,
  updatedAt: '2026-10-28T12:00:00.000Z',
};
const value: FileDraftValue = {
  name: 'Contacts.md',
  content: '# My local edits\n',
  appearance: { theme: 'dim', accent: '#abcdef' },
};

test('local draft storage isolates spaces and file identities without delimiter collisions', () => {
  assert.notEqual(fileDraftStorageKey('a:b', 'c'), fileDraftStorageKey('a', 'b:c'));
  assert.notEqual(fileDraftStorageKey('one', file.id), fileDraftStorageKey('two', file.id));
  assert.notEqual(fileDraftStorageKey('one', 'first'), fileDraftStorageKey('one', 'second'));
  const raw = serializeFileDraft(value, file);
  assert.equal(recoverFileDraft(raw, { ...file, id: 'another-file' }), null);
});

test('recovery restores the filename, appearance and incomplete content without rewriting it', () => {
  for (const name of ['draft.md', 'draft.txt', 'draft.widget']) {
    const draft = { ...value, name, content: '  unfinished\n\n```wya-item\n{\n  "label": "' };
    const result = recoverFileDraft(serializeFileDraft(draft, file), file);
    assert.deepEqual(result, { ...draft, conflict: false });
  }
});

test('metadata-only updates do not conflict, but changed content, names and appearance do', () => {
  const raw = serializeFileDraft(value, file);
  assert.equal(
    recoverFileDraft(raw, { ...file, version: 9, pinned: true, folderId: 'folder' })?.conflict,
    false,
  );
  for (const update of [
    { content: '# Changed elsewhere\n' },
    { name: 'Elsewhere.md' },
    { appearance: { theme: 'black' as const } },
  ]) {
    assert.equal(recoverFileDraft(raw, { ...file, ...update })?.conflict, true);
  }
});

test('a draft already matching the server needs no recovery regardless of version', () => {
  const raw = serializeFileDraft(value, file);
  assert.equal(recoverFileDraft(raw, { ...file, ...value, version: 20 }), null);
  assert.equal(
    recoverFileDraft(serializeFileDraft({ ...value, appearance: { accent: '#abc' } }, file), {
      ...file,
      ...value,
      appearance: { accent: '#aabbcc' },
    }),
    null,
  );
});

test('missing, malformed and incompatible records cannot replace a draft', () => {
  for (const raw of [null, '', '{', 'null', '[]', '{}']) {
    assert.equal(recoverFileDraft(raw, file), null);
  }
  const record = JSON.parse(serializeFileDraft(value, file));
  for (const update of [
    { version: 2 },
    { fileId: null },
    { value: null },
    { base: null },
    { value: { ...value, name: '../draft.md' } },
    { value: { ...value, name: 'draft.html' } },
    { value: { ...value, name: 'a'.repeat(101) + '.md' } },
    { value: { ...value, content: 12 } },
    { value: { ...value, content: 'text\0text' } },
    { value: { ...value, appearance: { theme: 'unknown' } } },
    { value: { ...value, appearance: { accent: 'url(javascript:bad)' } } },
    { value: { ...value, appearance: { extra: 'invalid' } } },
    { base: { ...record.base, content: false } },
  ]) {
    assert.equal(recoverFileDraft(JSON.stringify({ ...record, ...update }), file), null);
  }
});

test('draft content bounds count UTF-8 bytes and protect both the value and base snapshots', () => {
  for (const content of ['a'.repeat(MAX_FILE_BYTES + 1), 'é'.repeat(MAX_FILE_BYTES / 2 + 1)]) {
    assert.equal(recoverFileDraft(serializeFileDraft({ ...value, content }, file), file), null);
    assert.equal(recoverFileDraft(serializeFileDraft(value, { ...file, content }), file), null);
  }
  const content = 'é'.repeat(MAX_FILE_BYTES / 2);
  assert.equal(
    recoverFileDraft(serializeFileDraft({ ...value, content }, file), file)?.content,
    content,
  );
  assert.equal(recoverFileDraft(' '.repeat(MAX_FILE_BYTES * 12 + 4097), file), null);
});
