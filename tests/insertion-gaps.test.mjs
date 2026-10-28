import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

// Bundle the real extension and schema together, matching the browser's module
// resolution and avoiding duplicate ProseMirror registries in Node.
const { outputFiles } = buildSync({
  stdin: {
    contents: `
      export { getExtensionField, getSchema } from '@tiptap/core';
      export { EditorState, TextSelection } from '@tiptap/pm/state';
      export { baseKeymap } from '@tiptap/pm/commands';
      export { createInsertionGaps } from './app/components/document-editor/insertion-gaps';
      export { createRichDocumentExtensions } from './lib/rich-document-schema';
      export { markdownToRichDocument, richDocumentToMarkdown } from './lib/rich-document';
      export { serializePageItem } from './lib/page-documents';
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  mainFields: ['module', 'main'],
  logLevel: 'silent',
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const {
  getExtensionField,
  getSchema,
  EditorState,
  TextSelection,
  baseKeymap,
  createInsertionGaps,
  createRichDocumentExtensions,
  markdownToRichDocument,
  richDocumentToMarkdown,
  serializePageItem,
} = compiled.exports;

const schema = getSchema(createRichDocumentExtensions());
const paragraph = (text = '') =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const card = (slug) =>
  schema.nodes.wyaItem.create({ item: { id: slug, slug, label: slug, visible: true } });
const section = (content) =>
  schema.nodes.wyaSection.create({ id: 'legacy', title: 'Legacy section' }, content);

function fixture(content) {
  const editor = { isEditable: true };
  const plugins = getExtensionField(
    createInsertionGaps({ labels: { add: 'Start a new line here' } }),
    'addProseMirrorPlugins',
    { editor },
  )();
  const plugin = plugins[0];
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, content),
    plugins,
  });
  return { editor, plugin, state };
}

const decorations = (plugin, state) => plugin.props.decorations.call(plugin, state);

// Only implement the DOM construction/event surface used by widget factories.
// The real ProseMirror state, key commands, transactions and decorations run
// below; visual positioning and actual browser focus are checked separately.
class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.textContent = '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }
}

const dom = {
  createElement: (tag) => new Element(tag),
  createElementNS: (_, tag) => new Element(tag),
};
const descendants = (element) => [element, ...element.children.flatMap(descendants)];

function renderWidget(decoration, state, getPos = () => decoration.from) {
  const dispatched = [];
  const view = {
    dom: { ownerDocument: dom },
    state,
    editable: true,
    focusCount: 0,
    dispatch(transaction) {
      dispatched.push(transaction);
      view.state = view.state.apply(transaction);
    },
    focus() {
      view.focusCount++;
    },
  };
  const element = decoration.type.toDOM(view, getPos);
  return { element, view, dispatched };
}

function addButton(element) {
  const elements = descendants(element);
  const buttons = elements.filter((child) => child.tagName === 'button');
  assert.equal(buttons.length, 1, 'a gap has only its add control, never a writing lane');
  assert.equal(elements.map((child) => child.textContent).join(''), '');
  const button = buttons[0];
  assert.equal(button.type, 'button');
  assert.equal(button.attributes.get('aria-label'), 'Start a new line here');
  assert.equal(button.attributes.has('aria-haspopup'), false);
  assert.equal(button.attributes.has('aria-expanded'), false);
  assert.notEqual(button.attributes.get('tabindex'), '-1');
  return button;
}

function activate(button) {
  let prevented = false;
  let stopped = false;
  button.listeners.get('click')({
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
}

for (const key of ['Backspace', 'Delete']) {
  test(`${key} removes the paragraph created by + without restoring a writing lane`, () => {
    const first = card('first');
    const last = card('last');
    const { plugin, state: initial } = fixture([first, last]);
    const insertion = decorations(plugin, initial)
      .find()
      .find((entry) => entry.from === first.nodeSize);
    const mounted = renderWidget(insertion, initial);
    activate(addButton(mounted.element));
    let state = mounted.view.state;
    assert.equal(state.doc.childCount, 3);
    assert.equal(state.doc.child(1).type.name, 'paragraph');
    assert.ok(state.selection instanceof TextSelection);
    assert.equal(state.selection.from, first.nodeSize + 1);
    assert.equal(mounted.view.focusCount, 1);
    assert.equal(
      baseKeymap[key](state, (transaction) => {
        state = state.apply(transaction);
      }),
      true,
    );
    assert.deepEqual(
      state.doc.content.content.map((node) => node.attrs.item?.slug),
      ['first', 'last'],
    );
    assert.equal(state.doc.childCount, 2);
    const gap = decorations(plugin, state)
      .find()
      .find((entry) => entry.from === first.nodeSize);
    assert.ok(gap, 'adjacent cards remain insertable after deleting their paragraph');
    const { element, dispatched } = renderWidget(gap, state);
    assert.equal(element.contentEditable, 'false');
    addButton(element);
    assert.deepEqual(dispatched, []);
    state.doc.check();
  });
}

test('empty paragraphs have one leading add control, including a completely empty document', () => {
  const first = card('first');
  const empty = paragraph();
  const { plugin, state } = fixture([first, empty, card('last')]);
  assert.deepEqual(
    decorations(plugin, state)
      .find()
      .map((entry) => entry.from),
    [0, 1, 4],
  );
  const middleGap = decorations(plugin, state)
    .find()
    .find((entry) => entry.from === 1);
  const middle = renderWidget(middleGap, state);
  activate(addButton(middle.element));
  assert.ok(middle.view.state.doc.eq(state.doc), '+ reuses the existing empty paragraph');
  assert.equal(middle.view.state.selection.from, 2);
  assert.equal(middle.dispatched.length, 1);
  assert.equal(middle.dispatched[0].docChanged, false);
  assert.equal(middle.view.focusCount, 1);
  const blank = fixture([paragraph()]);
  const gaps = decorations(blank.plugin, blank.state).find();
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].from, 0);
  const { element, view } = renderWidget(gaps[0], blank.state);
  assert.equal(element.dataset.richInsertion, 'before');
  activate(addButton(element));
  assert.ok(view.state.doc.eq(blank.state.doc));
  assert.equal(view.state.selection.from, 1);
  assert.equal(view.focusCount, 1);
});

test('controls use document and legacy section boundaries, never quote or list interiors', () => {
  const heading = schema.nodes.heading.create({ level: 2 }, schema.text('Heading'));
  const quote = schema.nodes.blockquote.create(null, paragraph('Quoted'));
  const list = schema.nodes.bulletList.create(
    null,
    schema.nodes.listItem.create(null, paragraph('Listed')),
  );
  const group = section([card('nested-first'), card('nested-last')]);
  const { plugin, state } = fixture([heading, quote, list, group]);
  const groupStart = heading.nodeSize + quote.nodeSize + list.nodeSize;
  assert.deepEqual(
    decorations(plugin, state)
      .find()
      .map((entry) => entry.from)
      .sort((a, b) => a - b),
    [
      0,
      heading.nodeSize,
      heading.nodeSize + quote.nodeSize,
      groupStart,
      groupStart + 1,
      groupStart + 2,
      groupStart + 3,
      groupStart + group.nodeSize,
    ],
  );
});

test('+ immediately creates a focused writing paragraph without changing Markdown until typed', () => {
  const markdown =
    ['first', 'last']
      .map((slug) =>
        serializePageItem({
          id: slug,
          slug,
          label: slug,
          url: `https://example.com/${slug}`,
          visible: true,
        }),
      )
      .join('\n\n') + '\n';
  const parsed = schema.nodeFromJSON(markdownToRichDocument(markdown));
  const { plugin, state } = fixture(parsed.content.content);
  const originalSelection = state.selection;
  const gap = decorations(plugin, state)
    .find()
    .find((entry) => entry.from === state.doc.firstChild.nodeSize);
  const { element, view, dispatched } = renderWidget(gap, state);
  const button = addButton(element);
  let pointerPrevented = false;
  button.listeners.get('pointerdown')({
    preventDefault: () => {
      pointerPrevented = true;
    },
  });
  assert.equal(pointerPrevented, true, 'pointerdown preserves the caret until activation');
  assert.equal(view.state.selection, originalSelection);
  assert.deepEqual(dispatched, []);
  activate(button);
  assert.equal(dispatched.length, 1);
  assert.equal(view.focusCount, 1);
  assert.equal(view.state.doc.childCount, parsed.childCount + 1);
  assert.equal(view.state.doc.nodeAt(gap.from).type.name, 'paragraph');
  assert.equal(view.state.doc.nodeAt(gap.from).content.size, 0);
  assert.ok(view.state.selection instanceof TextSelection);
  assert.equal(view.state.selection.from, gap.from + 1);
  assert.equal(view.state.selection.empty, true);
  assert.equal(richDocumentToMarkdown(view.state.doc.toJSON(), markdown), markdown);
  view.dispatch(view.state.tr.insertText('New text between the cards'));
  assert.equal(view.state.doc.child(1).textContent, 'New text between the cards');
  const saved = richDocumentToMarkdown(view.state.doc.toJSON(), markdown);
  assert.notEqual(saved, markdown);
  const roundTrip = schema.nodeFromJSON(markdownToRichDocument(saved));
  assert.equal(roundTrip.child(0).attrs.item.slug, 'first');
  assert.equal(roundTrip.child(1).textContent, 'New text between the cards');
  assert.equal(roundTrip.child(2).attrs.item.slug, 'last');
});

test('activation resolves a mapped boundary and ignores removed or read-only positions', () => {
  const { editor, plugin, state } = fixture([card('first'), card('last')]);
  const set = decorations(plugin, state);
  const gap = set.find().find((entry) => entry.from === 1);
  let position = gap.from;
  const { element, view, dispatched } = renderWidget(gap, state, () => position);
  const button = addButton(element);
  const transaction = state.tr.insert(0, paragraph('Before'));
  view.state = state.apply(transaction);
  const mapped = set
    .map(transaction.mapping, transaction.doc)
    .find()
    .find((entry) => entry.spec.key === gap.spec.key);
  position = mapped.from;
  activate(button);
  assert.equal(dispatched.length, 1);
  assert.equal(view.focusCount, 1);
  assert.equal(view.state.doc.child(0).textContent, 'Before');
  assert.equal(view.state.doc.child(1).attrs.item.slug, 'first');
  assert.equal(view.state.doc.child(2).type.name, 'paragraph');
  assert.equal(view.state.doc.child(2).content.size, 0);
  assert.equal(view.state.doc.child(3).attrs.item.slug, 'last');
  assert.equal(view.state.selection.from, 2 + paragraph('Before').nodeSize);
  const afterInsertion = view.state;

  position = 2; // Inside the preceding paragraph, no longer a block boundary.
  activate(button);
  position = undefined;
  activate(button);
  position = mapped.from;
  view.editable = false;
  activate(button);
  assert.equal(dispatched.length, 1);
  assert.equal(view.focusCount, 1);
  assert.equal(view.state, afterInsertion);
  editor.isEditable = false;
  assert.equal(decorations(plugin, view.state).find().length, 0);
});
