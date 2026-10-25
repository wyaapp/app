import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePageDraft, samePageDraft, serializePageDraft } from '../lib/page-draft.ts';
import type { PageDraftValue } from '../lib/page-draft.ts';

const published: PageDraftValue = { source: '# Hello\n', appearance: { accent: 'sky' } };

test('an appearance-only draft survives reload without changing Markdown or its baseline', () => {
  const draft = {
    value: { ...published, appearance: { accent: 'rose' as const, bodyFont: 'serif' as const } },
    base: published,
  };
  const restored = restorePageDraft(JSON.parse(serializePageDraft(draft)), published)!;
  assert.deepEqual(restored, draft);
  assert.equal(samePageDraft(restored.value, published), false);
  assert.equal(samePageDraft(restored.base, published), true);
  assert.equal(
    samePageDraft(restored.base, { ...published, appearance: { accent: 'lime' } }),
    false,
  );
});

test('resetting appearance is a publishable change and does not affect the source', () => {
  const draft = { value: { ...published, appearance: {} }, base: published };
  const restored = restorePageDraft(JSON.parse(serializePageDraft(draft)), published)!;
  assert.equal(samePageDraft(restored.value, published), false);
  assert.deepEqual(restored.value.appearance, {});
  assert.equal(restored.value.source, published.source);
  assert.equal(restorePageDraft(JSON.parse(serializePageDraft(draft)), draft.value), null);
});

test('source-only drafts from older versions retain published appearance and incomplete text', () => {
  const source = '::link[unfinished]{slug="draft"}\n';
  const restored = restorePageDraft(
    { version: 1, source, baseSource: published.source },
    published,
  )!;
  assert.deepEqual(restored.value.appearance, published.appearance);
  assert.deepEqual(restored.base, published);
  assert.equal(restored.value.source, source);
});

test('draft comparisons ignore optional-field order and empty inherited values', () => {
  assert.equal(
    samePageDraft(
      { source: '', appearance: { bodyFont: 'mono', accent: 'navy' } },
      { source: '', appearance: { accent: 'navy', bodyFont: 'mono', theme: undefined } },
    ),
    true,
  );
  assert.equal(restorePageDraft({ version: 3, source: '', baseSource: '' }, published), null);
  assert.equal(restorePageDraft({ version: 2, source: [], baseSource: '' }, published), null);
});
