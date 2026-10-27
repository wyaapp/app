import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState, NodeSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import { markdownToRichDocument, richDocumentToMarkdown } from '../lib/rich-document.ts';
import { insertRichBlock } from '../lib/rich-document-insertion.ts';
import { richBlockWidgetSource, widgetDocumentConstraint } from '../lib/rich-document-widgets.ts';
import { parseWidgetSource } from '../lib/widget-files.ts';

const schema = getSchema(createRichDocumentExtensions());
const paragraph = (text = '') =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const document = (source: string) =>
  schema.nodeFromJSON(markdownToRichDocument(source, { wya: true }));
const gif = () => schema.nodes.gif.create({ gif: { provider: 'giphy', id: 'YsTs5ltWtEhnq' } });
const source = (state: EditorState) =>
  richDocumentToMarkdown(state.doc.toJSON(), undefined, { wya: true });

function createState(content = '') {
  let rejected = 0;
  const state = EditorState.create({
    doc: document(content),
    plugins: [history(), widgetDocumentConstraint(() => rejected++)],
  });
  return { state, rejected: () => rejected };
}

test('widget insertion preserves normal block insertion, caret positions and undo', () => {
  const initial = createState();
  let state = initial.state.apply(insertRichBlock(initial.state, gif(), { pos: 0 })!);
  assert.equal(state.doc.firstChild!.type.name, 'gif');
  assert.equal(state.doc.lastChild!.type.name, 'paragraph');
  assert.equal(parseWidgetSource(source(state))?.kind, 'gif');
  assert.equal(initial.rejected(), 0);
  assert.equal(
    undo(state, (transaction) => {
      state = state.apply(transaction);
    }),
    true,
  );
  assert.equal(source(state).trim(), '');
});

test('widget editor refuses additional blocks or pasted prose without changing saved content', () => {
  const initial = createState('```js\nconst a = 1;\n```');
  const original = initial.state.doc;
  for (const added of [paragraph('pasted prose'), gif(), schema.nodes.horizontalRule.create()]) {
    const next = initial.state.apply(initial.state.tr.insert(original.content.size, added));
    assert.ok(next.doc.eq(original));
  }
  assert.equal(initial.rejected(), 3);
});

test('widget editor accepts code edits and removal, but not code turned into ordinary text', () => {
  const initial = createState('```js\nlet x = 1;\n```');
  let state = initial.state.apply(initial.state.tr.insertText('\nlet y = 2;', 11));
  assert.match(source(state), /let y = 2/);
  assert.equal(initial.rejected(), 0);
  const text = state.tr.setNodeMarkup(0, schema.nodes.paragraph);
  assert.ok(state.apply(text).doc.eq(state.doc));
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)).deleteSelection());
  assert.equal(source(state).trim(), '');
  assert.equal(initial.rejected(), 1);
});

test('single selected widget copies serialize independently while unsupported selections are rejected', () => {
  for (const input of [
    '```js\nconsole.log("display only");\n```',
    '::p5{url="https://editor.p5js.org/alexcmgit/sketches/UVdcShVG4" title="Lightning"}',
    '::gif{provider="giphy" id="YsTs5ltWtEhnq"}',
  ]) {
    const node = document(input).firstChild!;
    const copied = richBlockWidgetSource(node.toJSON());
    assert.ok(copied);
    assert.ok(parseWidgetSource(copied, { allowEmpty: false }));
    assert.equal(node.eq(document(input).firstChild!), true);
  }
  for (const input of ['hello', '# Title', '> quotation', '---'])
    assert.equal(richBlockWidgetSource(document(input).firstChild!.toJSON()), null);
});

test('Discord copy omits source identity and section without altering the original node', () => {
  const item = {
    id: 'original-card',
    sectionId: 'original-section',
    kind: 'discord',
    slug: 'community',
    label: 'Community',
    platform: 'discord',
    url: '',
    visible: true,
    discord: { guildId: '771498135188799500' },
  };
  const node = schema.nodes.wyaItem.create({ item });
  const copied = richBlockWidgetSource(node.toJSON());
  assert.ok(copied);
  const parsed = parseWidgetSource(copied);
  assert.equal(parsed?.kind, 'discord');
  assert.doesNotMatch(copied, /original-card|original-section/);
  assert.equal(node.attrs.item.id, 'original-card');
  assert.equal(node.attrs.item.sectionId, 'original-section');
});

test('widget constraint allows replacing the selected block, rejects multiple blocks atomically', () => {
  const initial = createState('```js\nlet answer = 42;\n```');
  const replacement = initial.state.tr.replaceWith(0, initial.state.doc.content.size, gif());
  const next = initial.state.apply(replacement);
  assert.equal(parseWidgetSource(source(next))?.kind, 'gif');
  const multiple = next.tr.replaceWith(0, next.doc.content.size, [gif(), gif()]);
  assert.ok(next.apply(multiple).doc.eq(next.doc));
  assert.equal(initial.rejected(), 1);
});

test('copying unsupported cards or malformed reserved fences never creates a widget', () => {
  const unsupported = schema.nodes.wyaItem.create({
    item: {
      slug: 'site',
      label: 'Site',
      url: 'https://example.com',
      platform: 'website',
      visible: true,
    },
  });
  const invalid = schema.nodes.codeBlock.create(
    { language: 'p5' },
    schema.text('{"url":"javascript:alert(1)"}'),
  );
  assert.equal(richBlockWidgetSource(unsupported.toJSON()), null);
  assert.equal(richBlockWidgetSource(invalid.toJSON()), null);
});
