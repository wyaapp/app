import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkDirective from 'remark-directive';
import { remarkStrikethrough } from '../lib/remark-strikethrough.ts';
import { gifFromMarker, remarkGifEmbeds } from '../lib/remark-gif.ts';

function render(source: string, preserveUnknown = false) {
  return renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [
          remarkDirective,
          remarkStrikethrough,
          [remarkGifEmbeds, { preserveUnknown }],
        ],
        skipHtml: true,
        components: {
          div: ({ node, children }) => {
            const gif = gifFromMarker(node?.properties);
            return gif
              ? createElement('figure', { 'data-provider': gif.provider, 'data-id': gif.id })
              : createElement('div', {}, children);
          },
        },
      },
      source,
    ),
  );
}

test('a GIF directive renders as a block between paragraphs, with no paragraph around its figure', () => {
  const html = render('Before.\n\n::gif[Hello]{provider="giphy" id="abc123"}\n\nAfter.');
  assert.match(
    html,
    /<p>Before\.<\/p>\s*<figure data-provider="giphy" data-id="abc123"><\/figure>\s*<p>After\.<\/p>/,
  );
  assert.ok(!html.includes('<p><figure'));
  assert.ok(!html.includes('data-wya-gif'));
});

test('ordinary colon prose remains visible in file previews and public page documents', () => {
  for (const preserveUnknown of [false, true]) {
    const html = render('Say :hello, use a ratio of 1:2, and keep :smile:.', preserveUnknown);
    assert.equal(html, '<p>Say :hello, use a ratio of 1:2, and keep :smile:.</p>');
  }
});

test('plain file previews preserve unsupported directives as ordinary Markdown', () => {
  for (const source of [
    'Plain :link[hello]{url="https://example.com"} text.',
    '::unknown[Label]{value="preserve me"}',
    ':::note\nA **bold** and ~~struck~~ note.\n:::',
    '> ::unknown[Label]{value="keep me"}',
    '- First\n\n  ::unknown[Another block]',
    ':::unknown\n::gif[Keep literal]{provider="giphy" id="abc123"}\n:::',
    '::gif[Invalid]{provider="other" id="abc123"}',
  ]) {
    const standard = renderToStaticMarkup(
      createElement(Markdown, { remarkPlugins: [remarkStrikethrough], skipHtml: true }, source),
    );
    assert.equal(render(source, true), standard, source);
  }
});

test('colon text in GIF titles does not prevent validated embeds', () => {
  const html = render('::gif[Say :hello]{provider="giphy" id="abc123"}', true);
  assert.match(html, /<figure data-provider="giphy" data-id="abc123">/);
});

test('GIFs inside other Markdown blocks use the same validated marker', () => {
  const html = render('> ::gif[Wave]{provider="tenor" id="123456" width="480" height="270"}');
  assert.match(html, /<blockquote>\s*<figure data-provider="tenor" data-id="123456">/);
});

test('invalid directives, inline directives and user-supplied HTML cannot create an embed', () => {
  for (const source of [
    '::gif[Hello]{provider="other" id="abc123"}',
    '::gif[Hello]{provider="giphy" id="../outside"}',
    '::gif[Hello]{provider="giphy" id="abc123" src="https://other.example"}',
    '::gif[Hello]{provider="giphy" id="abc123" width="9000"}',
    'Inline :gif[Hello]{provider="giphy" id="abc123"}.',
    '<iframe src="https://other.example"></iframe>',
    '<div data-wya-gif=\'{"provider":"giphy","id":"abc123"}\'></div>',
  ]) {
    const html = render(source);
    assert.ok(!html.includes('<figure'), source);
    assert.ok(!html.includes('<iframe'), source);
  }
});

test('markers are revalidated before returning provider data', () => {
  assert.equal(gifFromMarker(undefined), null);
  assert.equal(gifFromMarker({ 'data-wya-gif': '{' }), null);
  assert.equal(
    gifFromMarker({ 'data-wya-gif': '{"provider":"tenor","id":"//other.example"}' }),
    null,
  );
  assert.deepEqual(
    gifFromMarker({ 'data-wya-gif': '{"provider":"giphy","id":"abc123","title":"Hello"}' }),
    {
      provider: 'giphy',
      id: 'abc123',
      title: 'Hello',
    },
  );
});
