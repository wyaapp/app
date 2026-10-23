import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDocumentItemDraft } from '../lib/document-item-draft.ts';
import { compilePageDocument } from '../lib/page-document-actions.ts';
import type { ProfileData } from '../lib/profile-types.ts';

const empty: ProfileData = { name: 'Alex', bio: '', theme: 'lilac', links: [] };
const existing: ProfileData = {
  ...empty,
  links: [
    {
      slug: 'code',
      aliases: ['repo'],
      label: 'Code',
      platform: 'github',
      url: 'https://github.com/alex',
      visible: true,
    },
  ],
};
const link = {
  action: 'upsert_link',
  slug: 'new',
  label: 'My account',
  destination: 'alex',
  platform: 'github',
  createOnly: true,
};

test('local card edits normalize form input and leave saved source and projection untouched', () => {
  const before = JSON.stringify(existing);
  const next = applyDocumentItemDraft(
    existing,
    existing,
    {
      ...link,
      createOnly: false,
      originalSlug: 'code',
      slug: ' WORK ',
      aliases: ['repo', 'code'],
    },
    'home',
  );
  assert.equal(next.slug, 'work');
  assert.equal(next.url, 'https://github.com/alex');
  assert.equal(next.id, 'legacy:code');
  assert.deepEqual(next.aliases, ['repo', 'code']);
  assert.equal(JSON.stringify(existing), before);
});

test('new and re-edited draft cards omit temporary IDs and remain publishable', () => {
  const created = applyDocumentItemDraft(empty, empty, link, 'home');
  assert.equal(created.id, undefined);
  const compiled = compilePageDocument(
    empty,
    'home',
    '::link[My account]{slug="new" url="https://github.com/alex" platform="github"}',
  );
  assert.ok(compiled.links[0].id);
  const changed = applyDocumentItemDraft(
    compiled,
    empty,
    {
      ...link,
      createOnly: false,
      originalSlug: 'new',
      slug: 'renamed',
    },
    'home',
  );
  assert.equal(changed.id, undefined);
  assert.equal(changed.slug, 'renamed');
  const publishable = `::link[${changed.label}]{slug="${changed.slug}" url="${changed.url}" platform="${changed.platform}"}`;
  assert.equal(compilePageDocument(empty, 'home', publishable).links[0].slug, 'renamed');
});

test('collection forms can reference preview child IDs without persisting them', () => {
  const collection = applyDocumentItemDraft(
    empty,
    empty,
    {
      action: 'upsert_collection',
      slug: 'games',
      label: 'Games',
      visible: true,
      entries: [
        { game: { title: 'My game', source: { provider: 'igdb', id: 1, slug: 'my-game' } } },
      ],
    },
    'home',
  );
  assert.equal(collection.id, undefined);
  assert.equal(collection.collection!.items[0].id, undefined);
  const source = '```wya-item\n' + JSON.stringify(collection, null, 2) + '\n```';
  const compiled = compilePageDocument(empty, 'home', source);
  const normalized = compiled.links[0];
  const changed = applyDocumentItemDraft(
    compiled,
    empty,
    {
      action: 'upsert_collection',
      originalSlug: 'games',
      slug: 'games',
      label: 'Favorites',
      entries: [
        {
          id: normalized.collection!.items[0].id!,
          buttons: [{ label: 'Play', destination: 'https://example.com' }],
        },
      ],
    },
    'home',
  );
  assert.equal(changed.id, undefined);
  assert.equal(changed.collection!.items[0].id, undefined);
  assert.equal(changed.collection!.items[0].url, 'https://example.com/');
  assert.equal(
    compilePageDocument(empty, 'home', '```wya-item\n' + JSON.stringify(changed) + '\n```').links[0]
      .label,
    'Favorites',
  );
  const savedEdit = applyDocumentItemDraft(
    compiled,
    compiled,
    {
      action: 'upsert_collection',
      originalSlug: 'games',
      slug: 'games',
      label: 'Saved favorites',
      entries: [{ id: normalized.collection!.items[0].id! }],
    },
    'home',
  );
  assert.equal(savedEdit.id, normalized.id);
  assert.equal(savedEdit.collection!.items[0].id, normalized.collection!.items[0].id);
});

test('local forms retain server validation for unsafe URLs, collisions and unsupported actions', () => {
  for (const input of [
    { ...link, destination: 'javascript:alert(1)' },
    { ...link, slug: 'repo' },
    { ...link, slug: 'code' },
    { action: 'delete_link', slug: 'code' },
    { action: 'update_profile', name: 'Wrong operation' },
    { ...link, id: 'forged' },
  ])
    assert.throws(() => applyDocumentItemDraft(existing, existing, input, 'home'));
  assert.throws(() => applyDocumentItemDraft(existing, existing, link, 'missing'));
});
