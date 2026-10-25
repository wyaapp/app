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
      export { BadgeEmbedView } from './app/components/badge-embed';
      export { PageDocument } from './app/components/page-document';
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
const { BadgeEmbedView, PageDocument } = compiled.exports;
const shields = {
  src: 'https://img.shields.io/badge/build-passing-brightgreen?style=flat',
  alt: 'Build passing',
  href: 'https://example.com/project',
};

const render = (badge, interactive = true) =>
  renderToStaticMarkup(createElement(BadgeEmbedView, { badge, interactive }));

test('Shields badges render as linked isolated images, not executable embeds', () => {
  const html = render(shields);
  assert.match(html, /<a class="web-badge" href="https:\/\/example.com\/project"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, /<img[^>]+src="https:\/\/img.shields.io\/badge\/build-passing/);
  assert.match(html, /alt="Build passing"/);
  assert.doesNotMatch(html, /<iframe|<object|<svg|<figure|width="100%"/);
});

test('editor badge previews cannot navigate away from the document', () => {
  const html = render(shields, false);
  assert.match(html, /<span class="web-badge"><img/);
  assert.doesNotMatch(html, /<a|href=/);
});

test('tiny copied classic badge images remain inline pixel art', () => {
  const html = render({
    src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    alt: 'Classic badge',
  });
  assert.match(html, /<span class="web-badge"><img class="is-pixel-art"/);
  assert.match(html, /src="data:image\/gif;base64,/);
  assert.doesNotMatch(html, /<a|<figure/);
});

test('unsafe badge images and destinations never reach the renderer', () => {
  for (const badge of [
    { ...shields, src: 'javascript:alert(1)' },
    { ...shields, src: 'data:image/svg+xml,<svg onload="alert(1)"></svg>' },
    { ...shields, href: 'javascript:alert(1)' },
    { ...shields, href: 'data:text/html,hello' },
  ])
    assert.equal(render(badge), '');
});

function document(source, preserveUnknown) {
  return renderToStaticMarkup(
    createElement(PageDocument, {
      source,
      profile: { handle: 'owner', links: [] },
      preserveUnknown,
    }),
  );
}

test('page and plain-file rendering retain linked Markdown badges inline with surrounding prose', () => {
  for (const preserveUnknown of [false, true]) {
    const html = document(
      `Before [![Build passing](${shields.src})](${shields.href}) after.`,
      preserveUnknown,
    );
    assert.match(html, /<p>Before <a class="web-badge"/);
    assert.match(html, /href="https:\/\/example.com\/project"/);
    assert.match(html, /alt="Build passing"/);
    assert.match(html, /<\/a> after\.<\/p>/);
    assert.doesNotMatch(html, /<figure|image-embed|file-image-alt|This document could not/);
  }
});

test('page and plain-file rendering preserve copied PNG badge data and adjacent badges on one line', () => {
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz9kAAAAASUVORK5CYII=';
  for (const preserveUnknown of [false, true]) {
    const html = document(
      `:badge[Classic]{src="${png}"} :badge[Build]{src="${shields.src}" href="${shields.href}"}`,
      preserveUnknown,
    );
    assert.match(html, /<p><span class="web-badge"><img class="is-pixel-art"/);
    assert.match(html, /src="data:image\/png;base64,/);
    assert.equal((html.match(/class="web-badge"/g) ?? []).length, 2);
    assert.equal((html.match(/<p>/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<figure|image-embed|:badge|data-wya-badge|This document could not/);
  }
});

test('standalone Shields Markdown uses the small inline badge renderer, while photos retain image rendering', () => {
  for (const preserveUnknown of [false, true]) {
    const html = document(
      `![Build](${shields.src})\n\n![Photo](https://images.example/photo.png)`,
      preserveUnknown,
    );
    assert.match(html, /<p><span class="web-badge"><img/);
    assert.equal((html.match(/class="web-badge"/g) ?? []).length, 1);
    assert.equal((html.match(/<figure class="image-embed"/g) ?? []).length, 1);
  }
});
