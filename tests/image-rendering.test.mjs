import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { outputFiles } = buildSync({
  stdin: {
    contents: `export { PageDocument } from './app/components/page-document';`,
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
const { PageDocument } = compiled.exports;

function render(source, preserveUnknown = true) {
  return renderToStaticMarkup(
    createElement(PageDocument, {
      source,
      profile: { handle: 'owner', links: [] },
      preserveUnknown,
    }),
  );
}

test('public image blocks render the direct media with the same default width as the editor', () => {
  for (const preserveUnknown of [false, true]) {
    const html = render('![A cat](https://images.example/cat.gif "Hello")', preserveUnknown);
    assert.match(html, /<figure class="image-embed" style="max-width:384px"/);
    assert.match(html, /<img[^>]+src="https:\/\/images.example\/cat.gif"[^>]+alt="A cat"/);
    assert.match(html, /title="Hello"/);
    assert.doesNotMatch(html, /<iframe|<p><figure|file-image-alt/);
  }
});

test('resized and fill-width images survive the public renderer in pages and Markdown files', () => {
  for (const preserveUnknown of [false, true]) {
    for (const [size, expected] of [
      ['240', '240px'],
      ['full', 'none'],
    ]) {
      const html = render(
        `::image[An image]{src="https://images.example/image.png" size="${size}"}`,
        preserveUnknown,
      );
      assert.ok(html.includes(`class="image-embed" style="max-width:${expected}"`));
      assert.match(html, /alt="An image"/);
      assert.doesNotMatch(html, /This document could not|::image/);
    }
  }
});

test('inline Markdown images remain inside their paragraph without invalid block nesting', () => {
  const html = render('Before ![A cat](https://images.example/cat.png) after.');
  assert.match(html, /<p>Before <img class="document-inline-image"/);
  assert.doesNotMatch(html, /<figure/);
});

test('unsafe image URLs are not rendered as remote media', () => {
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,AAAA']) {
    const html = render(`![An image](${url})`);
    assert.doesNotMatch(html, /<img|<iframe|<figure/);
    assert.match(html, /An image/);
  }
});
