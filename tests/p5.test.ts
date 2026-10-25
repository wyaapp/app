import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkDirective from 'remark-directive';
import {
  normalizeP5Embed,
  parseP5Input,
  parseP5Node,
  parseP5Url,
  p5EditorProject,
  p5EmbedUrl,
  p5MarkdownNode,
} from '../lib/p5.ts';
import { remarkGifEmbeds } from '../lib/remark-gif.ts';
import { p5FromMarker, remarkP5Embeds } from '../lib/remark-p5.ts';

const url = 'https://editor.p5js.org/p5/sketches/4GluUaiHzPj';
const embed = { url, title: 'Drawing' };
const markdown = unified().use(remarkParse).use(remarkDirective).use(remarkStringify);

test('official share variants become a canonical link and a live preview URL', () => {
  for (const host of ['editor.p5js.org', 'preview.p5js.org'])
    for (const mode of ['sketches', 'full', 'embed', 'present']) {
      const input = `https://${host}/p5/${mode}/4GluUaiHzPj/?share=1#canvas`;
      assert.equal(parseP5Url(input), url);
      assert.equal(p5EmbedUrl(input), 'https://editor.p5js.org/p5/full/4GluUaiHzPj');
    }
  assert.deepEqual(p5EditorProject(url), { username: 'p5', id: '4GluUaiHzPj' });
  assert.equal(parseP5Input(url), url);
  assert.equal(parseP5Input(`<iframe src="${url}"></iframe>`), null);
});

test('non-p5 destinations and ambiguous URLs cannot become frame sources', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    'https://example.com/sketch.js',
    'https://localhost/sketch.js',
    'https://127.0.0.1/sketch.js',
    'http://editor.p5js.org/p5/embed/id',
    'https://user:pass@editor.p5js.org/p5/embed/id',
    'https://editor.p5js.org:8080/p5/embed/id',
    'https://editor.p5js.org/p5/\nembed/id',
    'https://editor.p5js.org/p5/\\embed/id',
    'https://editor.p5js.org/p5/sketches/id%2Fother',
    'https://editor.p5js.org/p5/sketches/id/other.js',
    'https://editor.p5js.org/editor/p5/projects/id',
    'https://editor.p5js.org/p5/unknown/id',
    'https://editor.p5js.org.evil.example/p5/embed/id',
  ]) {
    assert.equal(parseP5Url(value), null, value);
    assert.throws(() => p5EmbedUrl(value), /public p5/);
  }
});

test('normalization strips legacy code and accepts only bounded display metadata', () => {
  assert.deepEqual(
    normalizeP5Embed({ ...embed, source: 'function setup() { throw 1; }', extra: true }),
    embed,
  );
  assert.deepEqual(normalizeP5Embed({ url }), { url, title: 'p5.js sketch' });
  for (const invalid of [
    null,
    { ...embed, title: 'a'.repeat(101) },
    { ...embed, title: 'New\nline' },
    { ...embed, title: 42 },
    { ...embed, url: 'data:text/javascript,test' },
  ])
    assert.equal(normalizeP5Embed(invalid), null);
});

test('new Markdown contains only a hosted URL and title and round-trips punctuation', () => {
  const value = { ...embed, title: 'Quotes " & <tags> [brackets]' };
  const node = p5MarkdownNode(value);
  const source = markdown.stringify({ type: 'root', children: [node] });
  assert.match(source, /^::p5\{/);
  assert.ok(!source.includes('```'));
  assert.deepEqual(parseP5Node(markdown.parse(source).children[0]), value);
  assert.throws(
    () => p5MarkdownNode({ ...embed, url: 'https://example.com/sketch.js' }),
    /public p5/,
  );
});

test('legacy fences migrate to links without preserving or executing their JavaScript', () => {
  const node = {
    type: 'code' as const,
    lang: 'p5',
    meta: JSON.stringify(embed),
    value: 'function setup() { throw new Error("never execute"); }',
  };
  assert.deepEqual(parseP5Node(node), embed);
  const output = markdown.stringify({
    type: 'root',
    children: [p5MarkdownNode(parseP5Node(node)!)],
  });
  assert.ok(!output.includes('function'));
  for (const meta of [null, '{broken', '{}', JSON.stringify({ ...embed, unexpected: true })])
    assert.equal(parseP5Node({ ...node, meta }), null);
  assert.equal(parseP5Node({ ...node, lang: 'javascript' }), null);
  assert.equal(
    parseP5Node({
      ...node,
      meta: JSON.stringify({ ...embed, url: 'https://example.com/sketch.js' }),
    }),
    null,
  );
});

test('public markers contain link metadata only and render in normal and plain Markdown views', () => {
  const source = markdown.stringify({ type: 'root', children: [p5MarkdownNode(embed)] });
  const html = renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [
          remarkDirective,
          [remarkGifEmbeds, { preserveUnknown: true, wya: false }],
          remarkP5Embeds,
        ],
        skipHtml: true,
        components: {
          div: ({ node }) =>
            createElement('figure', { 'data-title': p5FromMarker(node?.properties)?.title }),
        },
      },
      source,
    ),
  );
  assert.equal(html, '<figure data-title="Drawing"></figure>');
  assert.deepEqual(
    p5FromMarker({
      'data-p5-embed': JSON.stringify({ ...embed, source: '<script>code</script>' }),
    }),
    embed,
  );
  assert.equal(p5FromMarker({ 'data-p5-embed': '{broken' }), null);
  assert.equal(
    p5FromMarker({
      'data-p5-embed': JSON.stringify({ ...embed, url: 'https://evil.example/page' }),
    }),
    null,
  );
});
