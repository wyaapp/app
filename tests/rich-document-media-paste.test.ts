import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JSONContent } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import type { Slice as ProseMirrorSlice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import {
  Editor,
  createRichDocumentExtensions,
  createMediaPaste,
  mediaPasteKey,
  mediaBlockToLink,
  mediaBlockUrl,
  markdownToRichDocument,
  richDocumentToMarkdown,
  Slice,
  Fragment,
  undo,
  redo,
} from './helpers/rich-editor.ts';

const imageUrl = 'https://images.example.com/cat.gif?size=large#frame';
const gifUrl = 'https://giphy.com/gifs/cat-JIX9t2j0ZTN9S?source=share';

function createEditor(source: string | JSONContent = '') {
  const editor = new Editor({
    element: null,
    extensions: [...createRichDocumentExtensions(), createMediaPaste()],
    content: typeof source === 'string' ? markdownToRichDocument(source) : source,
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
}

function paste(
  editor: Editor,
  value: string,
  options: {
    slice?: ProseMirrorSlice;
    editable?: boolean;
    composing?: boolean;
    files?: File[];
    afterDispatch?: () => void;
  } = {},
) {
  const plugin = mediaPasteKey.get(editor.state);
  assert.ok(plugin?.props.handlePaste);
  const slice =
    options.slice ??
    new Slice(
      Fragment.from(editor.schema.nodes.paragraph.create(null, editor.schema.text(value))),
      1,
      1,
    );
  const view = {
    get state() {
      return editor.state;
    },
    dispatch(tr: Transaction) {
      editor.view.dispatch(tr);
      options.afterDispatch?.();
    },
    editable: options.editable ?? true,
    composing: options.composing ?? false,
  } as EditorView;
  const event = {
    clipboardData: {
      files: options.files ?? [],
      getData(type: string) {
        return type === 'text/plain' ? value : '';
      },
    },
  } as unknown as ClipboardEvent;
  return plugin.props.handlePaste.call(plugin, view, event, slice);
}

function undoOnce(editor: Editor) {
  assert.equal(
    undo(editor.state, (tr) => editor.view.dispatch(tr)),
    true,
  );
}
function redoOnce(editor: Editor) {
  assert.equal(
    redo(editor.state, (tr) => editor.view.dispatch(tr)),
    true,
  );
}

for (const [label, url, nodeType] of [
  ['direct animated image', imageUrl, 'image'],
  ['GIPHY page', gifUrl, 'gif'],
  ['Tenor page', 'https://tenor.com/view/cat-gif-1234567', 'gif'],
] as const) {
  test(`pasting a ${label} embeds once, retains its URL and restores the link on Undo`, () => {
    const editor = createEditor();
    try {
      assert.equal(paste(editor, `  ${url}\n`), true);
      assert.equal(editor.state.doc.childCount, 2);
      assert.equal(editor.state.doc.firstChild?.type.name, nodeType);
      assert.equal(mediaBlockUrl(editor.state.doc.firstChild!), url);
      assert.equal(editor.state.selection.$from.parent.type.name, 'paragraph');
      assert.equal(editor.state.selection.$from.parent.content.size, 0);
      const embedded = editor.state.doc;
      const markdown = richDocumentToMarkdown(editor.getJSON());
      const restored = editor.schema.nodeFromJSON(markdownToRichDocument(markdown));
      assert.equal(mediaBlockUrl(restored.firstChild!), url);
      undoOnce(editor);
      assert.equal(editor.state.doc.childCount, 1);
      assert.equal(editor.state.doc.firstChild?.type.name, 'paragraph');
      assert.equal(editor.state.doc.textContent, url);
      assert.equal(editor.state.doc.firstChild?.firstChild?.marks[0].attrs.href, url);
      undoOnce(editor);
      assert.equal(editor.state.doc.textContent, '');
      redoOnce(editor);
      assert.equal(editor.state.doc.textContent, url);
      redoOnce(editor);
      assert.ok(editor.state.doc.eq(embedded));
    } finally {
      editor.destroy();
    }
  });
}

test('typing after the expanded image has a separate Undo step', () => {
  const editor = createEditor();
  try {
    assert.equal(paste(editor, imageUrl), true);
    const embedded = editor.state.doc;
    editor.view.dispatch(editor.state.tr.insertText('Next caption'));
    undoOnce(editor);
    assert.ok(editor.state.doc.eq(embedded));
    undoOnce(editor);
    assert.equal(editor.state.doc.textContent, imageUrl);
  } finally {
    editor.destroy();
  }
});

test('reuses an existing empty next paragraph without adding another line', () => {
  const editor = createEditor({
    type: 'doc',
    content: [{ type: 'paragraph' }, { type: 'paragraph' }],
  });
  try {
    assert.equal(paste(editor, imageUrl), true);
    assert.equal(editor.state.doc.childCount, 2);
    assert.equal(editor.state.selection.from, 2);
  } finally {
    editor.destroy();
  }
});

test('embeds inside a section or quote and preserves neighboring content', () => {
  for (const type of ['wyaSection', 'blockquote']) {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type,
          ...(type === 'wyaSection' ? { attrs: { title: 'Gallery', id: 'gallery' } } : {}),
          content: [
            { type: 'paragraph' },
            { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
          ],
        },
      ],
    });
    try {
      editor.commands.setTextSelection(2);
      assert.equal(paste(editor, imageUrl), true);
      assert.equal(editor.state.doc.firstChild?.type.name, type);
      assert.equal(editor.state.doc.firstChild?.childCount, 3);
      assert.equal(editor.state.doc.firstChild?.firstChild?.type.name, 'image');
      assert.equal(editor.state.doc.textContent, 'After');
      editor.state.doc.check();
    } finally {
      editor.destroy();
    }
  }
});

for (const [name, source, from, to] of [
  ['a sentence', 'Already typing here', 8, 8],
  ['selected text', 'Replace me', 1, 11],
  ['a heading', '# Title', 1, 1],
  ['a code block', '```\n\n```', 1, 1],
  ['a list item required paragraph', '- ', 2, 2],
] as const) {
  test(`leaves native paste behavior intact in ${name}`, () => {
    const editor = createEditor(source);
    try {
      editor.commands.setTextSelection({ from, to });
      const before = editor.state.doc;
      assert.equal(paste(editor, imageUrl), false);
      assert.strictEqual(editor.state.doc, before);
    } finally {
      editor.destroy();
    }
  });
}

test('an empty paragraph with inline code active keeps literal paste behavior', () => {
  const editor = createEditor();
  try {
    editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks.code.create()]));
    assert.equal(paste(editor, imageUrl), false);
    assert.equal(editor.state.doc.textContent, '');
  } finally {
    editor.destroy();
  }
});

for (const [name, value] of [
  ['ordinary page', 'https://example.com/blog'],
  ['multiple URLs', `${imageUrl}\nhttps://example.com/second.png`],
  ['URL in surrounding text', `Look at ${imageUrl}`],
  ['a non-HTTPS URL', 'http://example.com/image.png'],
  ['an HTML document masquerading in the query', 'https://example.com/page?file=image.png'],
  ['SVG', 'https://example.com/image.svg'],
] as const) {
  test(`does not claim paste for ${name}`, () => {
    const editor = createEditor();
    try {
      assert.equal(paste(editor, value), false);
      assert.equal(editor.state.doc.textContent, '');
    } finally {
      editor.destroy();
    }
  });
}

test('leaves read-only, composition, file paste and rich content to their existing handlers', () => {
  const editor = createEditor();
  try {
    assert.equal(paste(editor, imageUrl, { editable: false }), false);
    assert.equal(paste(editor, imageUrl, { composing: true }), false);
    assert.equal(paste(editor, imageUrl, { files: [{} as File] }), false);
    const bold = editor.schema.text(imageUrl, [editor.schema.marks.bold.create()]);
    assert.equal(paste(editor, imageUrl, { slice: new Slice(Fragment.from(bold), 0, 0) }), false);
    const media = editor.schema.nodes.image.create({ src: imageUrl });
    assert.equal(paste(editor, imageUrl, { slice: new Slice(Fragment.from(media), 0, 0) }), false);
    const paragraphs = Fragment.fromArray([
      editor.schema.nodes.paragraph.create(null, editor.schema.text(imageUrl)),
      editor.schema.nodes.paragraph.create(),
    ]);
    assert.equal(paste(editor, imageUrl, { slice: new Slice(paragraphs, 1, 1) }), false);
  } finally {
    editor.destroy();
  }
});

test('accepts a URL copied as one browser link', () => {
  const editor = createEditor();
  try {
    const link = editor.schema.text(imageUrl, [
      editor.schema.marks.link.create({ href: imageUrl }),
    ]);
    assert.equal(paste(editor, imageUrl, { slice: new Slice(Fragment.from(link), 0, 0) }), true);
    assert.equal(editor.state.doc.firstChild?.type.name, 'image');
  } finally {
    editor.destroy();
  }
});

test('a copied link with a different target keeps native paste and its original destination', () => {
  const editor = createEditor();
  try {
    const link = editor.schema.text(imageUrl, [
      editor.schema.marks.link.create({ href: 'https://example.com/original-destination' }),
    ]);
    const before = editor.state.doc;
    assert.equal(paste(editor, imageUrl, { slice: new Slice(Fragment.from(link), 0, 0) }), false);
    assert.strictEqual(editor.state.doc, before);
  } finally {
    editor.destroy();
  }
});

test('Convert to link preserves the source and is undoable with custom image size', () => {
  const editor = createEditor({
    type: 'doc',
    content: [
      { type: 'image', attrs: { src: imageUrl, size: 672 } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Caption' }] },
    ],
  });
  try {
    const before = editor.state.doc;
    const tr = mediaBlockToLink(editor.state, 0);
    assert.ok(tr);
    editor.view.dispatch(tr);
    assert.equal(editor.state.doc.firstChild?.textContent, imageUrl);
    assert.equal(editor.state.doc.lastChild?.textContent, 'Caption');
    assert.equal(editor.state.selection.from, imageUrl.length + 1);
    undoOnce(editor);
    assert.ok(editor.state.doc.eq(before));
    assert.equal(mediaBlockToLink(editor.state, -1), null);
    assert.equal(mediaBlockToLink(editor.state, 0.5), null);
    assert.equal(mediaBlockToLink(editor.state, editor.state.doc.content.size), null);
    assert.equal(mediaBlockToLink(editor.state, 1), null);
  } finally {
    editor.destroy();
  }
});

test('a synchronous outside document change during paste is not overwritten', () => {
  const editor = createEditor();
  try {
    let changed = false;
    assert.equal(
      paste(editor, imageUrl, {
        afterDispatch() {
          if (changed) return;
          changed = true;
          editor.view.dispatch(editor.state.tr.insertText('!', 1));
        },
      }),
      true,
    );
    assert.equal(editor.state.doc.textContent, `!${imageUrl}`);
    assert.equal(editor.state.doc.firstChild?.type.name, 'paragraph');
  } finally {
    editor.destroy();
  }
});
