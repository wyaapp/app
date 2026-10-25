import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema, type JSONContent } from '@tiptap/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkDirective from 'remark-directive';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import { markdownToRichDocument, richDocumentToMarkdown } from '../lib/rich-document.ts';
import { parsePageSource, serializePageItem } from '../lib/page-documents.ts';
import { inlineFontId, remarkFonts } from '../lib/remark-fonts.ts';
import { remarkGifEmbeds } from '../lib/remark-gif.ts';
import { remarkStrikethrough } from '../lib/remark-strikethrough.ts';
import type { LinkItem } from '../lib/profile-types.ts';

const schema = getSchema(createRichDocumentExtensions());
const nodes = (node: JSONContent): JSONContent[] => [node, ...(node.content ?? []).flatMap(nodes)];
const font = (node: JSONContent) =>
  node.marks?.find((mark) => mark.type === 'fontFamily')?.attrs?.font;

test('font selections round trip across ordinary Markdown and Wya page prose', () => {
  const prose = [
    '# :font[A **Geo** heading]{family="geo"}',
    '',
    'Default, :font[**bold** *italic* ~~strike~~ [link](https://example.com)]{family="jetbrains-mono"}.',
    '',
    '- :font[A list item]{family="serif"}',
    '',
    '> :font[A quote]{family="system"}',
  ].join('\n');
  const item: LinkItem = {
    id: 'stable-id',
    slug: 'project',
    label: 'Project',
    url: 'https://example.com',
    platform: 'website',
    aliases: ['work'],
    visible: true,
  };
  for (const wya of [false, true]) {
    const input = wya ? `${prose}\n\n${serializePageItem(item)}` : prose;
    const doc = schema.nodeFromJSON(markdownToRichDocument(input, { wya }));
    doc.check();
    assert.equal(richDocumentToMarkdown(doc.toJSON(), input, { wya }), input);
    const edited = doc.toJSON();
    const bold = nodes(edited).find((node) => node.text === 'bold')!;
    assert.equal(font(bold), 'jetbrains-mono');
    assert.ok(bold.marks?.some((mark) => mark.type === 'bold'));
    bold.text = 'updated';
    const result = richDocumentToMarkdown(edited, input, { wya });
    const restored = schema.nodeFromJSON(markdownToRichDocument(result, { wya }));
    restored.check();
    assert.equal(
      font(nodes(restored.toJSON()).find((node) => node.text === 'updated')!),
      'jetbrains-mono',
    );
    assert.equal(font(nodes(restored.toJSON()).find((node) => node.text === 'Geo')!), 'geo');
    if (wya) assert.deepEqual(parsePageSource(result).items[0].item, item);
  }
});

test('font runs merge without changing nested formatting or neighboring font choices', () => {
  const fontMark = { type: 'fontFamily', attrs: { font: 'geo' } };
  const document: JSONContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'One ', marks: [fontMark] },
          { type: 'text', text: 'bold', marks: [fontMark, { type: 'bold' }] },
          { type: 'text', text: ' run', marks: [fontMark] },
          {
            type: 'text',
            text: ' mono',
            marks: [{ type: 'fontFamily', attrs: { font: 'jetbrains-mono' } }],
          },
          { type: 'text', text: ' default' },
        ],
      },
    ],
  };
  const result = richDocumentToMarkdown(document);
  assert.equal((result.match(/:font\[/g) ?? []).length, 2);
  const restored = nodes(markdownToRichDocument(result));
  assert.equal(font(restored.find((node) => node.text === 'bold')!), 'geo');
  assert.equal(font(restored.find((node) => node.text === ' mono')!), 'jetbrains-mono');
  assert.equal(font(restored.find((node) => node.text === ' default')!), undefined);
});

test('nested font overrides use the innermost selection and code retains its fixed typography', () => {
  const source = ':font[Outer :font[inner]{family="geo"} outer `code`]{family="serif"}';
  const doc = schema.nodeFromJSON(markdownToRichDocument(source));
  doc.check();
  const content = nodes(doc.toJSON());
  assert.equal(font(content.find((node) => node.text === 'Outer ')!), 'serif');
  assert.equal(font(content.find((node) => node.text === 'inner')!), 'geo');
  assert.equal(font(content.find((node) => node.text === ' outer ')!), 'serif');
  assert.equal(font(content.find((node) => node.text === 'code')!), undefined);
  assert.equal(richDocumentToMarkdown(doc.toJSON(), source), source);
});

test('font directives cannot inject CSS, URLs, or arbitrary HTML attributes', () => {
  const invalid = [
    ':font[Text]{family="Comic Sans"}',
    ':font[Text]{family="geo; color:red"}',
    ':font[Text]{family="https://example.com/font.woff2"}',
    ':font[Text]{family="geo" onclick="alert(1)"}',
    ':font[Text]{family="__proto__"}',
  ];
  assert.equal(inlineFontId('__proto__'), null);
  assert.equal(inlineFontId('constructor'), null);
  for (const source of invalid) {
    const doc = schema.nodeFromJSON(markdownToRichDocument(source));
    doc.check();
    assert.ok(nodes(doc.toJSON()).every((node) => !font(node)));
    assert.equal(doc.textContent, source);
    assert.equal(richDocumentToMarkdown(doc.toJSON(), source), source);
  }
  assert.throws(
    () =>
      richDocumentToMarkdown({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Unsafe',
                marks: [{ type: 'fontFamily', attrs: { font: 'geo; color:red' } }],
              },
            ],
          },
        ],
      }),
    /not supported/,
  );
});

test('file and page previews render safe inline fonts with formatting and still skip raw HTML', () => {
  const source =
    '# :font[Geo **heading**]{family="geo"}\n\n:font[Mono *body*]{family="jetbrains-mono"}\n\n<script>alert(1)</script>\n\n:font[Plain]{family="geo" onclick="alert(1)"}';
  for (const preserveUnknown of [false, true]) {
    const output = renderToStaticMarkup(
      createElement(
        Markdown,
        {
          remarkPlugins: [
            remarkDirective,
            remarkStrikethrough,
            [remarkGifEmbeds, { preserveUnknown }],
            remarkFonts,
          ],
          skipHtml: true,
        },
        source,
      ),
    );
    assert.ok(output.includes('data-font-family="geo"'));
    assert.ok(output.includes('data-font-family="jetbrains-mono"'));
    assert.ok(output.includes('--inline-font-body:&#x27;Geo&#x27;, sans-serif'));
    assert.ok(output.includes('<strong>heading</strong>') && output.includes('<em>body</em>'));
    assert.ok(!output.includes('<script') && !/<[^>]+\sonclick=/.test(output));
    assert.equal((output.match(/data-font-family=/g) ?? []).length, 2);
  }
});
