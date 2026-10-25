import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Nodes, Root } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkStringify from 'remark-stringify';
import {
  MAX_BADGE_IMAGE_BYTES,
  badgeFromMarkdownNode,
  badgeIsPixelArt,
  badgeMarkdownNode,
  isBadgeDataUrl,
  normalizeBadgeEmbed,
  parseBadgeDirective,
  parseBadgeInput,
  parseBadgeUrl,
} from '../lib/badge.ts';
import { badgeFromMarker, remarkBadgeEmbeds } from '../lib/remark-badges.ts';
import { remarkImageEmbeds } from '../lib/remark-images.ts';

const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz9kAAAAASUVORK5CYII=';
const shield =
  'https://img.shields.io/badge/build-passing-brightgreen?style=flat-square&logo=github';
const parser = unified().use(remarkParse).use(remarkDirective).use(remarkStringify);

function inline(source: string): Nodes {
  const paragraph = parser.parse(source).children[0];
  assert.equal(paragraph.type, 'paragraph');
  return paragraph.children[0];
}

test('badges accept safe HTTPS image sources and optional web destinations', () => {
  assert.deepEqual(normalizeBadgeEmbed({ src: shield, alt: 'Build status' }), {
    src: shield,
    alt: 'Build status',
  });
  assert.deepEqual(normalizeBadgeEmbed({ src: shield, alt: '', href: 'http://example.com/' }), {
    src: shield,
    alt: '',
    href: 'http://example.com/',
  });
  assert.deepEqual(normalizeBadgeEmbed({ src: shield, ignored: 'not stored' }), {
    src: shield,
    alt: '',
  });
  for (const src of [
    'javascript:alert(1)',
    'http://example.com/badge.png',
    '//example.com/badge.png',
    '/badge.png',
    'https://user:password@example.com/badge.png',
    'https://example.com:8080/badge.png',
    'https://example.com/\nbadge.png',
    'https://example.com/path\\badge.png',
  ])
    assert.equal(normalizeBadgeEmbed({ src }), null, src);
  for (const invalid of [
    { src: shield, href: 'javascript:alert(1)' },
    { src: shield, href: 'data:text/html,hello' },
    { src: shield, href: 'https://user:pass@example.com/' },
    { src: shield, alt: 42 },
    { src: shield, alt: 'x'.repeat(201) },
    { src: shield, alt: 'Title\nnext line' },
  ])
    assert.equal(normalizeBadgeEmbed(invalid), null);
});

test('archive raster data URLs are signature checked and bounded by dimensions and bytes', () => {
  for (const src of [gif, png]) {
    assert.equal(isBadgeDataUrl(src), true);
    assert.deepEqual(normalizeBadgeEmbed({ src, alt: 'Old web' }), { src, alt: 'Old web' });
    assert.equal(badgeIsPixelArt(src), true);
  }
  for (const src of [
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:text/html;base64,PGltZz4=',
    'data:image/png;base64,PHN2Zz48L3N2Zz4=',
    'data:image/gif;base64,' + png.split(',')[1],
    'data:image/png;base64,AAAA',
    gif + '\n',
    gif.slice(0, -1),
    'data:image/gif;base64,' + 'A'.repeat(Math.ceil((MAX_BADGE_IMAGE_BYTES + 1) / 3) * 4),
  ])
    assert.equal(isBadgeDataUrl(src), false, src.slice(0, 90));

  const original = Buffer.from(gif.split(',')[1], 'base64');
  for (const [width, height] of [
    [0, 15],
    [321, 15],
    [80, 0],
    [80, 65],
  ]) {
    const bytes = Buffer.from(original);
    bytes.writeUInt16LE(width, 6);
    bytes.writeUInt16LE(height, 8);
    assert.equal(isBadgeDataUrl(`data:image/gif;base64,${bytes.toString('base64')}`), false);
  }
  const oversized = Buffer.concat([original, Buffer.alloc(MAX_BADGE_IMAGE_BYTES)]);
  assert.equal(isBadgeDataUrl(`data:image/gif;base64,${oversized.toString('base64')}`), false);
  const pngBytes = Buffer.from(png.split(',')[1], 'base64');
  pngBytes.writeUInt32BE(65536, 16);
  assert.equal(isBadgeDataUrl(`data:image/png;base64,${pngBytes.toString('base64')}`), false);
});

test('automatic URL detection is limited to real badge providers and safe archive data', () => {
  for (const src of [
    shield,
    'https://img.shields.io/github/stars/badges/shields?style=social',
    'https://web.badges.world/badges/programs/editor.gif',
    gif,
  ])
    assert.deepEqual(parseBadgeUrl(` ${src}\n`), { src, alt: 'Badge' });
  for (const src of [
    'https://img.shields.io/',
    'https://shields.io/badges/static-badge',
    'https://web.badges.world/',
    'https://example.com/badge.png',
    'https://img.shields.io.evil.example/badge/test',
    'https://web.badges.world.evil.example/badge.gif',
  ])
    assert.equal(parseBadgeUrl(src), null, src);
  assert.equal(badgeIsPixelArt(shield), false);
});

test('explicit badge input supports remote URLs, copied archive data, and normal Markdown snippets', () => {
  const src = 'https://example.com/my-badge.svg';
  assert.deepEqual(parseBadgeInput(src), { src, alt: 'Badge' });
  assert.deepEqual(parseBadgeInput(gif), { src: gif, alt: 'Badge' });
  assert.deepEqual(parseBadgeInput(`![Build](${shield})`), { src: shield, alt: 'Build' });
  assert.deepEqual(parseBadgeInput(`[![Build](${shield})](https://example.com/project)`), {
    src: shield,
    alt: 'Build',
    href: 'https://example.com/project',
  });
  assert.deepEqual(parseBadgeInput(`:badge[Build]{src="${shield}" href="https://example.com/"}`), {
    src: shield,
    alt: 'Build',
    href: 'https://example.com/',
  });
  for (const source of [
    `Before ![Build](${shield})`,
    `![Build](${shield}) after`,
    `![First](${shield}) ![Second](${shield})`,
    `<img src="${shield}" onerror="alert(1)">`,
    `[![Build](${shield})](javascript:alert)`,
    `![Unsafe](data:image/svg+xml;base64,PHN2Zz4=)`,
  ])
    assert.equal(parseBadgeInput(source), null, source);
});

test('inline badge syntax round-trips labels, URL parameters, and adjacent prose', () => {
  const badge = {
    src: shield,
    alt: 'Build *status* [here] & "more" :yes:',
    href: 'https://example.com/?source=badge&view=project',
  };
  const source = parser.stringify({
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Before ' },
          badgeMarkdownNode(badge),
          { type: 'text', value: ' after.' },
        ],
      },
    ],
  });
  const paragraph = parser.parse(source).children[0];
  assert.equal(paragraph.type, 'paragraph');
  assert.deepEqual(parseBadgeDirective(paragraph.children[1]), badge);
  assert.equal(paragraph.children[0].type, 'text');
  assert.equal(paragraph.children[2].type, 'text');
  assert.deepEqual(
    parseBadgeDirective(
      inline(
        parser.stringify({
          type: 'root',
          children: [
            { type: 'paragraph', children: [badgeMarkdownNode({ src: gif, alt: 'Tiny badge' })] },
          ],
        }),
      ),
    ),
    { src: gif, alt: 'Tiny badge' },
  );
});

test('invalid badge syntax is never interpreted as media', () => {
  for (const source of [
    ':badge[Unsafe]{src="javascript:alert(1)"}',
    `:badge[Build]{src="${shield}" onclick="alert(1)"}`,
    `:badge[**Build**]{src="${shield}"}`,
    `:badge[Build]{src="${shield}" href="javascript:alert(1)"}`,
  ])
    assert.equal(parseBadgeDirective(inline(source)), null, source);
  assert.equal(
    parseBadgeDirective(parser.parse(`::badge[Build]{src="${shield}"}`).children[0]),
    null,
  );
  assert.throws(() => badgeMarkdownNode({ src: 'data:text/html,test', alt: '' }), /badge image/);
});

test('known provider Markdown becomes inline badges without converting unrelated photos', () => {
  const linked = inline(`[![Build](${shield})](https://example.com/project)`);
  assert.deepEqual(badgeFromMarkdownNode(linked), {
    src: shield,
    alt: 'Build',
    href: 'https://example.com/project',
  });
  assert.equal(badgeFromMarkdownNode(inline('![Photo](https://example.com/photo.png)')), null);
  const processor = parser().use(remarkBadgeEmbeds).use(remarkImageEmbeds);
  const tree = processor.runSync(
    processor.parse(
      `![Build](${shield})\n\nBefore [![Badge](${shield})](https://example.com/) after.\n\n![Photo](https://example.com/photo.png)`,
    ),
  ) as Root;
  const badgeParagraph = tree.children[0];
  assert.equal(badgeParagraph.type, 'paragraph');
  assert.equal(badgeParagraph.data?.hName, undefined);
  assert.equal(badgeParagraph.children[0].data?.hName, 'span');
  assert.deepEqual(badgeFromMarker(badgeParagraph.children[0].data?.hProperties), {
    src: shield,
    alt: 'Build',
  });
  const prose = tree.children[1];
  assert.equal(prose.type, 'paragraph');
  assert.equal(prose.children.length, 3);
  assert.equal(badgeFromMarker(prose.children[1].data?.hProperties)?.href, 'https://example.com/');
  assert.equal(tree.children[2].data?.hName, 'div');
});

test('public badge markers are validated again before rendering', () => {
  assert.deepEqual(
    badgeFromMarker({ 'data-wya-badge': JSON.stringify({ src: gif, alt: 'GIF' }) }),
    { src: gif, alt: 'GIF' },
  );
  for (const marker of [
    '{broken',
    JSON.stringify({ src: 'javascript:alert(1)' }),
    'x'.repeat(32769),
  ])
    assert.equal(badgeFromMarker({ 'data-wya-badge': marker }), null);
});
