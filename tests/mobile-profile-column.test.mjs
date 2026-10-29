import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { outputFiles } = buildSync({
  stdin: {
    contents: `
      export { MobileProfileColumn } from './app/components/desktop-profile/mobile-profile-column';
      export { FileCardProvider } from './app/components/document-card-context';
      export { ProfileItem } from './app/components/profile-item';
      export { PublicAddressProvider } from './app/components/public-address-provider';
      export { serializePageItem } from './lib/page-documents';
      export { resolveMobileFiles } from './lib/mobile-layout';
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
  MobileProfileColumn,
  FileCardProvider,
  ProfileItem,
  PublicAddressProvider,
  serializePageItem,
  resolveMobileFiles,
} = compiled.exports;
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const thirdId = '33333333-3333-4333-8333-333333333333';
const fourthId = '44444444-4444-4444-8444-444444444444';
const file = (id, name, content, extra = {}) => ({
  id,
  name,
  content,
  folderId: null,
  size: content.length,
  published: true,
  version: 0,
  hasChanges: false,
  pinned: true,
  updatedAt: '2026-10-29',
  ...extra,
});
const profile = {
  id: 'space',
  handle: 'alex',
  aliases: [],
  name: 'Alex Castro',
  bio: 'Hello from @alex',
  theme: 'lilac',
  version: 1,
  updatedAt: '2026-10-29',
  links: [],
};
const render = (props = {}, customDomain = false) =>
  renderToStaticMarkup(
    createElement(
      PublicAddressProvider,
      { customDomain },
      createElement(MobileProfileColumn, { profile, files: [], ...props }),
    ),
  );

test('mobile profile renders identity and selected files in order directly in server markup', () => {
  const files = [
    file(secondId, 'First.txt', '<script>unsafe()</script>\n  exact spacing'),
    file(firstId, 'Second.md', '# Markdown heading\n\n**Bold** text'),
    file(thirdId, 'Third.widget', '```js\nconst x = "<tag>";\n```', {
      appearance: { theme: 'black', accent: '#ffcc00' },
    }),
  ];
  const html = render({ files });
  assert.match(html, /<h1>Alex Castro<\/h1>/);
  assert.match(html, /Hello from/);
  assert.deepEqual(
    [...html.matchAll(/data-mobile-file="([^"]+)"/g)].map((match) => match[1]),
    files.map((entry) => entry.id),
  );
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;\n  exact spacing/);
  assert.doesNotMatch(html, /<script>|desktop-window-controls|Publish changes|Download|Loading…/);
  assert.match(html, /<h1 class="page-markdown-heading">Markdown heading<\/h1>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(
    html,
    /<pre class="widget-code" tabindex="0"><code class="language-js">const x = &quot;&lt;tag&gt;&quot;;/,
  );
  assert.match(html, /data-document-theme="black"/);
  assert.match(html, /--document-background:#000000/);
  assert.match(html, /--document-accent:#ffcc00/);
  assert.equal((html.match(/class="desktop-window-bar"/g) ?? []).length, 3);
  assert.equal((html.match(/class="desktop-window-handle mobile-file-heading"/g) ?? []).length, 3);
});

test('explicit empty mobile selection still renders Bio and does not fall back to hidden files', () => {
  const full = {
    ...profile,
    mobileLayout: { fileIds: [] },
    files: [file(firstId, 'Secret.txt', 'Do not render')],
  };
  const html = render({ profile: full, files: resolveMobileFiles(full) });
  assert.match(html, /<h1>Alex Castro<\/h1>/);
  assert.doesNotMatch(html, /data-mobile-file|Secret|Do not render/);
  const preview = render({ preview: true });
  assert.match(preview, /<h2>Alex Castro<\/h2>/);
});

test('mobile rendering uses published snapshots when a selected file has private pending changes', () => {
  const full = {
    ...profile,
    mobileLayout: { fileIds: [firstId] },
    files: [
      file(firstId, 'Private draft.md', '# Private draft', {
        version: 3,
        hasChanges: true,
        publishedName: 'Public.md',
        publishedContent: '# Public content',
      }),
    ],
  };
  const html = render({ profile: full, files: resolveMobileFiles(full) });
  assert.match(html, /Public.md|Public content/);
  assert.doesNotMatch(html, /Private draft/);
});

test('mobile card IDs cannot collide with desktop while short links and analytics retain published file ownership', () => {
  const item = {
    id: 'project',
    slug: 'project',
    label: 'Project',
    url: 'https://example.com',
    platform: 'portfolio',
    visible: true,
    kind: 'project',
    project: {
      description: 'Project details',
      buttons: [{ label: 'Visit', url: 'https://example.com' }],
    },
  };
  const indexed = [{ ...item, fileId: firstId }];
  const props = {
    profile: { ...profile, links: indexed },
    files: [file(firstId, 'Project.md', serializePageItem(item))],
  };
  const desktop = renderToStaticMarkup(
    createElement(
      FileCardProvider,
      { fileId: firstId, publishedLinks: indexed },
      createElement(ProfileItem, { item, handle: 'alex', preview: false }),
    ),
  );
  const mobile = render(props);
  assert.match(desktop, new RegExp(`id="file-${firstId}-project-project"`));
  assert.match(mobile, new RegExp(`id="mobile-file-${firstId}-project-project"`));
  assert.match(mobile, /href="\/alex\/project"/);
  assert.match(mobile, /data-analytics-item="project"/);
  assert.match(render(props, true), /href="\/project"/);
  const allIds = [...(desktop + mobile).matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(allIds.length, new Set(allIds).size);
  assert.doesNotMatch(render({ ...props, preview: true }), /data-analytics-item/);
});

test('mobile widget sections reuse Discord, GIF and hosted p5 renderers with reserved media sizing', () => {
  const discord = {
    id: 'discord',
    slug: 'community',
    label: 'Community',
    url: '',
    platform: 'discord',
    visible: true,
    kind: 'discord',
    discord: { guildId: '123456789012345678' },
  };
  const files = [
    file(firstId, 'Discord.widget', serializePageItem(discord)),
    file(
      secondId,
      'Gif.widget',
      '::gif[Demo]{provider="tenor" id="123456" width="480" height="320"}',
    ),
    file(
      thirdId,
      'Sketch.widget',
      '::p5{url="https://editor.p5js.org/alexcmgit/sketches/UVdcShVG4" title="Sketch"}',
    ),
    file(fourthId, 'Malformed.widget', '# Invalid widget'),
  ];
  const html = render({ files });
  assert.match(html, /discord-widget/);
  assert.match(html, /gif-embed/);
  assert.match(html, /p5-embed/);
  assert.match(html, /--mobile-media-ratio:480 \/ 320/);
  assert.match(html, /https:\/\/editor.p5js.org\/alexcmgit\/full\/UVdcShVG4/);
  assert.match(html, /This document could not be displayed/);
  assert.equal((html.match(/data-mobile-file=/g) ?? []).length, 4);
});
