import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Exercise the shared React renderers with their real context and forms.
const { outputFiles } = buildSync({
  stdin: {
    contents: `
      export { FileCardProvider } from './app/components/document-card-context';
      export { ProfileItem } from './app/components/profile-item';
      export { PublicAddressProvider } from './app/components/public-address-provider';
      export { LinkEditor } from './app/dashboard/link-editor';
      export { ProjectEditor } from './app/dashboard/project-editor';
      export { CollectionEditor } from './app/dashboard/collection-editor';
      export { DiscordEditor } from './app/dashboard/discord-editor';
      export { PageDocument } from './app/components/page-document';
      export { serializePageSection } from './lib/page-documents';
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['react', 'react/*', 'react-dom/*', 'next/*'],
  jsx: 'automatic',
  logLevel: 'silent',
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const {
  FileCardProvider,
  ProfileItem,
  PublicAddressProvider,
  LinkEditor,
  ProjectEditor,
  CollectionEditor,
  DiscordEditor,
  PageDocument,
  serializePageSection,
} = compiled.exports;
const fileId = '11111111-1111-4111-8111-111111111111';
const link = {
  id: 'copied-item',
  slug: 'same-slug',
  url: 'https://example.com/destination',
  label: 'Example',
  platform: 'website',
  visible: true,
};
const buttons = [
  { label: 'First', url: link.url },
  { label: 'Second', url: 'https://example.com/second' },
];
const project = {
  ...link,
  kind: 'project',
  platform: 'portfolio',
  project: { description: 'A project', buttons },
};
const game = {
  ...link,
  kind: 'interest',
  interest: { type: 'game', note: '', favorite: false, buttons },
};
const collection = {
  ...link,
  id: 'collection',
  kind: 'collection',
  slug: 'collection',
  url: '',
  collection: { type: 'game', items: [game] },
};
const discord = {
  ...link,
  kind: 'discord',
  platform: 'discord',
  url: '',
  discord: { guildId: '123456789012345678' },
};

function render(Component, props, { file = false, customDomain = false } = {}) {
  const content = createElement(Component, props);
  return renderToStaticMarkup(
    createElement(
      PublicAddressProvider,
      { customDomain },
      file ? createElement(FileCardProvider, { fileId }, content) : content,
    ),
  );
}

test('tab cards keep short URLs while file cards use direct destinations on every address', () => {
  for (const item of [
    link,
    project,
    game,
    { ...game, interest: { ...game.interest, buttons: [] } },
    collection,
  ]) {
    const props = { item, handle: 'owner', preview: false };
    assert.match(render(ProfileItem, props), /href="\/owner\/same-slug"/);
    assert.match(render(ProfileItem, props, { customDomain: true }), /href="\/same-slug"/);
    for (const customDomain of [false, true]) {
      const output = render(ProfileItem, props, { file: true, customDomain });
      assert.match(output, /href="https:\/\/example.com\/destination"/);
      assert.doesNotMatch(output, /href="\//);
      assert.doesNotMatch(output, /data-analytics-item/);
    }
  }
  const email = { ...link, platform: 'email', url: 'mailto:owner@example.com' };
  assert.match(
    render(ProfileItem, { item: email, handle: 'owner', preview: false }, { file: true }),
    /href="mailto:owner@example.com"/,
  );
});

test('file card IDs cannot collide with copied profile cards and previews stay inert', () => {
  for (const item of [project, game, collection, discord]) {
    const props = { item, handle: 'owner', preview: false };
    const published = render(ProfileItem, props, { file: true });
    const ids = [...published.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(ids.length > 0);
    assert.ok(ids.every((id) => id.startsWith(`file-${fileId}-`)));
    assert.doesNotMatch(published, /data-analytics-item/);
    const preview = render(ProfileItem, { ...props, preview: true }, { file: true });
    assert.doesNotMatch(preview, /<a\b|data-analytics-item/);
  }
});

test('file card forms omit global slug and alias promises without changing profile forms', () => {
  const common = {
    handle: 'owner',
    existingSlugs: [],
    busy: false,
    onSave: async () => true,
    onClose: () => {},
    presentation: 'window',
  };
  for (const [Component, item] of [
    [LinkEditor, { link }],
    [ProjectEditor, { project }],
    [CollectionEditor, { item: collection }],
    [DiscordEditor, { item: discord }],
  ]) {
    assert.match(render(Component, { ...common, ...item }), /URL slug/);
    const output = render(Component, { ...common, ...item }, { file: true });
    assert.doesNotMatch(
      output,
      /Your short URL|URL slug|Extra short URLs|wya\.im\/owner|Visible on profile/,
    );
    assert.match(output, /Visible in document/);
  }
});

test('file Markdown renders legacy section titles as headings and keeps every card destination', () => {
  const items = [
    { ...link, id: 'link', slug: 'link' },
    { ...project, id: 'project', slug: 'project' },
    { ...game, id: 'game', slug: 'game' },
    collection,
    { ...discord, id: 'discord', slug: 'discord' },
    { ...link, id: 'hidden', slug: 'hidden', label: 'Hidden payload', visible: false },
  ];
  const source = [
    '# My document',
    '::note[Preserved extension]',
    serializePageSection({ id: 'featured', title: 'Featured' }, items),
  ].join('\n\n');
  const profile = {
    id: 'space',
    handle: 'owner',
    name: 'Owner',
    bio: '',
    theme: 'lilac',
    aliases: [],
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    links: items,
  };
  const output = render(PageDocument, { source, profile, preserveUnknown: true }, { file: true });
  assert.match(output, /My document/);
  assert.match(output, /Preserved extension/);
  assert.match(output, /<h3 class="page-markdown-heading">Featured<\/h3>/);
  assert.doesNotMatch(output, /public-link-section/);
  for (const className of [
    'public-link',
    'project-tile',
    'interest-tile',
    'collection-widget',
    'discord-widget',
  ])
    assert.ok(output.includes(className), className);
  assert.match(output, /href="https:\/\/example.com\/destination"/);
  assert.match(output, /href="https:\/\/example.com\/second"/);
  assert.doesNotMatch(output, /href="\/|Hidden payload|data-analytics-item|page-document-error/);
});

test('opaque file extensions preserve malformed Wya-like text while valid cards still render', () => {
  const source = [
    ':::note',
    '::item{data="not JSON"}',
    ':::',
    '',
    '::link[Safe]{slug="safe" url="https://example.com"}',
  ].join('\n');
  const profile = {
    id: 'space',
    handle: 'owner',
    name: 'Owner',
    bio: '',
    theme: 'lilac',
    aliases: [],
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    links: [{ ...link, slug: 'safe', label: 'Safe', url: 'https://example.com' }],
  };
  const output = render(PageDocument, { source, profile, preserveUnknown: true }, { file: true });
  assert.match(output, /:::note/);
  assert.match(output, /::item\{data=&quot;not JSON&quot;\}/);
  assert.match(output, /href="https:\/\/example.com"/);
  assert.match(output, /public-link/);
  assert.doesNotMatch(output, /page-document-error/);
});
