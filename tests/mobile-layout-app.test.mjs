import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { outputFiles } = buildSync({
  stdin: {
    contents: `export { MobileLayoutApp } from './app/components/desktop-profile/mobile-layout-app';`,
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
const { MobileLayoutApp } = compiled.exports;
const files = [
  { id: 'intro', name: 'Intro.md', published: true },
  { id: 'chat', name: 'Community.widget', published: true },
  { id: 'notes', name: 'Notes.txt', published: true },
  { id: 'private', name: 'Private.md', published: false },
];

function render(value, options = {}) {
  return renderToStaticMarkup(
    createElement(MobileLayoutApp, {
      files,
      value,
      onSave() {
        assert.fail('Rendering must never persist a mobile layout.');
      },
      ...options,
    }),
  );
}

function selectedMarkup(html) {
  return html.match(/<ol class="mobile-layout-list">(.*?)<\/ol>/)?.[1] ?? '';
}

function buttonWithLabel(html, label) {
  const button = [...html.matchAll(/<button\b[^>]*>/g)].find((match) =>
    match[0].includes(`aria-label="${label}"`),
  );
  assert.ok(button, `Button with label ${label} must exist.`);
  return button[0];
}

test('mobile layout shows the saved order with one first marker and bounded movement controls', () => {
  const html = render(['chat', 'intro']);
  const selected = selectedMarkup(html);
  assert.ok(selected.indexOf('Community.widget') < selected.indexOf('Intro.md'));
  assert.equal((selected.match(/First in the column/g) ?? []).length, 1);
  assert.match(buttonWithLabel(selected, 'Move Community.widget up'), /disabled/);
  assert.match(buttonWithLabel(selected, 'Move Community.widget to first'), /disabled/);
  assert.doesNotMatch(buttonWithLabel(selected, 'Move Community.widget down'), /disabled/);
  assert.match(buttonWithLabel(selected, 'Move Intro.md down'), /disabled/);
  assert.doesNotMatch(buttonWithLabel(selected, 'Move Intro.md up'), /disabled/);
});

test('selected files cannot include drafts, duplicate IDs or unavailable files', () => {
  const html = render(['private', 'chat', 'chat', 'missing']);
  const selected = selectedMarkup(html);
  assert.equal((selected.match(/class="mobile-layout-selected"/g) ?? []).length, 1);
  assert.doesNotMatch(selected, /Private\.md|missing/);
  assert.match(buttonWithLabel(html, 'Show Private.md in the column'), /disabled/);
  assert.doesNotMatch(buttonWithLabel(html, 'Show Notes.txt in the column'), /disabled/);
  assert.match(html, /Draft - publish to add/);
});

test('empty selection stays empty and provides the Bio fallback explanation', () => {
  const html = render([]);
  assert.equal(selectedMarkup(html), '');
  assert.match(html, /The column will show only your Bio\./);
  assert.doesNotMatch(buttonWithLabel(html, 'Show Intro.md in the column'), /disabled/);
});

test('a clean layout never saves while rendering and Save and Discard are disabled', () => {
  const html = render(['intro']);
  assert.match(html, /Changes are applied when you save\./);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Discard changes<\/button>/);
  assert.match(html, /<button[^>]*class="button"[^>]*disabled=""[^>]*>.*?Save changes<\/button>/);
});

test('owner busy state disables all inclusion and ordering controls', () => {
  const html = render(['intro', 'chat'], { disabled: true });
  for (const label of [
    'Show Notes.txt in the column',
    'Move Intro.md down',
    'Move Community.widget up',
    'Hide Intro.md from the column',
    'Reorder Intro.md',
  ]) {
    assert.match(buttonWithLabel(html, label), /disabled/);
  }
});

test('page layout exposes screen scope and preserves the saved all-screen option', () => {
  const mobile = render(['intro']);
  assert.match(mobile, /<option value="mobile" selected="">On mobile only<\/option>/);
  const all = render(['intro'], { screens: 'all' });
  assert.match(all, /<option value="all" selected="">On all screen sizes<\/option>/);
  assert.match(all, /Visitors see the same column on phones, tablets and computers/);
  assert.match(render([], { disabled: true }), /<select[^>]*disabled/);
});
