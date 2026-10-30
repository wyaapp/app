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
      export { HighlightedCode } from './app/components/highlighted-code';
      export { PageDocument } from './app/components/page-document';
      export { WidgetView } from './app/components/widgets/widget-view';
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
const { HighlightedCode, PageDocument, WidgetView } = compiled.exports;
const profile = { handle: 'owner', links: [] };

function document(source) {
  return renderToStaticMarkup(
    createElement(PageDocument, { source, profile, preserveUnknown: true }),
  );
}

test('code is immediately readable on the server with original whitespace and escaped markup', () => {
  const source = '\tconst emoji = "🌩️";\r\n  <script>alert("x")</script> &\n\n';
  const html = renderToStaticMarkup(
    createElement(HighlightedCode, {
      source,
      language: 'html',
      className: 'widget-code',
      tabIndex: 0,
    }),
  );
  assert.equal(
    html,
    '<pre class="widget-code" tabindex="0"><code class="language-html">\tconst emoji = &quot;🌩️&quot;;\r\n  &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp;\n\n</code></pre>',
  );
  assert.doesNotMatch(html, /<script|<span|loading|aria-busy/);
});

test('Markdown fences retain their language and text while inline code stays inline', () => {
  const html = document('Use `const x = 1` here.\n\n```js\nconst x = "<tag>";\n\n```');
  assert.match(html, /<p>Use <code>const x = 1<\/code> here\.<\/p>/);
  assert.match(
    html,
    /<pre class="page-markdown-code"><code class="language-js">const x = &quot;&lt;tag&gt;&quot;;\n\n<\/code><\/pre>/,
  );
  assert.equal((html.match(/<pre/g) ?? []).length, 1);
});

test('plain, indented, and unknown-language Markdown remain readable without special wrappers', () => {
  for (const [source, language] of [
    ['```\nplain text\n```', ''],
    ['    plain text', ''],
    ['```unknown-language\nplain text\n```', ' class="language-unknown-language"'],
    ['```text\nplain text\n```', ' class="language-text"'],
  ]) {
    const html = document(source);
    assert.ok(
      html.includes(`<pre class="page-markdown-code"><code${language}>plain text\n</code></pre>`),
    );
    assert.doesNotMatch(html, /<span|This document could not/);
  }
});

test('code widgets retain keyboard scrolling and exactly the same source as shared code rendering', () => {
  const code = '// 🌩️\nconst value = "<div>";\n\n';
  for (const language of ['typescript', '', 'not-a-language']) {
    const html = renderToStaticMarkup(
      createElement(WidgetView, {
        block: { kind: 'code', language, code },
        profile,
        preview: false,
      }),
    );
    const shared = renderToStaticMarkup(
      createElement(HighlightedCode, {
        source: code,
        language,
        className: 'widget-code',
        tabIndex: 0,
      }),
    );
    assert.equal(html, shared);
    assert.match(html, /^<pre class="widget-code" tabindex="0"><code/);
    assert.ok(html.endsWith('// 🌩️\nconst value = &quot;&lt;div&gt;&quot;;\n\n</code></pre>'));
  }
});
