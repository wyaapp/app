import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Plugin, Transaction } from '@tiptap/pm/state';
import type { DecorationSet, EditorView } from '@tiptap/pm/view';
import {
  Editor,
  createRichDocumentExtensions,
  markdownToRichDocument,
  richDocumentToMarkdown,
} from './helpers/rich-editor.ts';

type CursorState = { active?: boolean; side?: number; next?: boolean } | null;

function createEditor(source: string) {
  const editor = new Editor({
    element: null,
    extensions: createRichDocumentExtensions(),
    content: markdownToRichDocument(source),
  });
  const plugins = editor.extensionManager.plugins;
  const cursor = plugins.find(
    (plugin) => plugin.props.attributes && plugin.props.decorations && plugin.props.handleKeyDown,
  ) as Plugin<CursorState> | undefined;
  assert.ok(cursor, 'the shared schema installs the codemark cursor plugin');
  // Headless Tiptap does not mount view plugins. Install the entire real chain
  // so plugin-key collisions and appendTransaction interactions are exercised.
  editor.view.updateState(editor.state.reconfigure({ plugins }));
  return { editor, cursor };
}

function press(
  editor: Editor,
  cursor: Plugin<CursorState>,
  key: string,
  options: Partial<KeyboardEvent> = {},
  viewOptions: { editable?: boolean; composing?: boolean } = {},
) {
  const view = {
    state: editor.state,
    dispatch: (tr: Transaction) => editor.view.dispatch(tr),
    editable: true,
    composing: false,
    ...viewOptions,
  } as EditorView;
  return cursor.props.handleKeyDown!.call(cursor, view, {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    preventDefault() {},
    ...options,
  } as KeyboardEvent);
}

/** Supplies ASCII native movement only when the real plugin passes an arrow on.
 * Browser checks are still required for painted caret positions and DOM behavior. */
function step(editor: Editor, cursor: Plugin<CursorState>, direction: -1 | 1, repeat = false) {
  const handled = press(editor, cursor, direction === 1 ? 'ArrowRight' : 'ArrowLeft', { repeat });
  if (!handled) editor.commands.setTextSelection(editor.state.selection.from + direction);
  return handled;
}

function firstCodeRange(editor: Editor) {
  let range: { from: number; to: number } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (!range && node.isText && node.marks.some((mark) => mark.type.name === 'code'))
      range = { from: pos, to: pos + node.nodeSize };
  });
  assert.ok(range);
  return range;
}

function assertRoundTrip(editor: Editor) {
  const markdown = richDocumentToMarkdown(editor.getJSON());
  assert.ok(editor.schema.nodeFromJSON(markdownToRichDocument(markdown)).eq(editor.state.doc));
}

test('Right progresses through both code boundaries without changing Markdown', () => {
  const source = 'L`xy`R';
  const { editor, cursor } = createEditor(source);
  try {
    editor.commands.setTextSelection(1);
    const doc = editor.state.doc;
    const expected: [number, boolean, number | undefined][] = [
      [2, false, -1],
      [2, true, 0],
      [3, true, undefined],
      [4, true, -1],
      [4, false, 0],
      [5, false, undefined],
    ];
    for (const [pos, code, side] of expected) {
      step(editor, cursor, 1);
      assert.equal(editor.state.selection.from, pos);
      assert.equal(editor.isActive('code'), code);
      assert.equal(cursor.getState(editor.state)?.side, side);
      assert.strictEqual(editor.state.doc, doc);
      assert.equal(richDocumentToMarkdown(editor.getJSON(), source), source);
    }
  } finally {
    editor.destroy();
  }
});

test('Left progresses through outside and inside stops in reverse order', () => {
  const { editor, cursor } = createEditor('L`xy`R');
  try {
    editor.commands.setTextSelection(5);
    const doc = editor.state.doc;
    for (const [pos, code] of [
      [4, false],
      [4, true],
      [3, true],
      [2, true],
      [2, false],
      [1, false],
    ] as const) {
      step(editor, cursor, -1);
      assert.equal(editor.state.selection.from, pos);
      assert.equal(editor.isActive('code'), code);
      assert.strictEqual(editor.state.doc, doc);
    }
  } finally {
    editor.destroy();
  }
});

test('repeated arrows cross successive code spans without an affinity loop', () => {
  const source = 'a`bc`d`ef`g';
  const { editor, cursor } = createEditor(source);
  try {
    editor.commands.setTextSelection(1);
    const doc = editor.state.doc;
    const positions = (direction: -1 | 1) =>
      Array.from({ length: 11 }, () => {
        step(editor, cursor, direction, true);
        return editor.state.selection.from;
      });
    assert.deepEqual(positions(1), [2, 2, 3, 4, 4, 5, 5, 6, 7, 7, 8]);
    assert.deepEqual(positions(-1), [7, 7, 6, 5, 5, 4, 4, 3, 2, 2, 1]);
    assert.strictEqual(editor.state.doc, doc);
    assert.equal(richDocumentToMarkdown(editor.getJSON(), source), source);
  } finally {
    editor.destroy();
  }
});

test('reversing at a code edge changes the typing side before crossing text', () => {
  const { editor, cursor } = createEditor('L`code`R');
  try {
    const { to } = firstCodeRange(editor);
    editor.commands.setTextSelection(to);
    const doc = editor.state.doc;
    for (let index = 0; index < 4; index += 1) {
      assert.equal(press(editor, cursor, 'ArrowRight'), true);
      assert.equal(editor.state.selection.from, to);
      assert.equal(editor.isActive('code'), false);
      assert.equal(press(editor, cursor, 'ArrowLeft'), true);
      assert.equal(editor.state.selection.from, to);
      assert.equal(editor.isActive('code'), true);
    }
    step(editor, cursor, -1);
    assert.equal(editor.state.selection.from, to - 1);
    assert.strictEqual(editor.state.doc, doc);
  } finally {
    editor.destroy();
  }
});

test('Space at either code boundary is inserted on the chosen side', () => {
  for (const edge of ['start', 'end'] as const) {
    for (const inside of [false, true]) {
      const { editor, cursor } = createEditor('before`code`after');
      try {
        const { from, to } = firstCodeRange(editor);
        const boundary = edge === 'start' ? from : to;
        const direction = edge === 'start' ? 1 : -1;
        editor.commands.setTextSelection(boundary - direction);
        step(editor, cursor, direction);
        if (inside) step(editor, cursor, direction);
        assert.equal(editor.state.selection.from, boundary);
        assert.equal(editor.isActive('code'), inside);
        editor.view.dispatch(editor.state.tr.insertText(' '));
        const runs = editor.state.doc.firstChild!.content.content;
        assert.equal(runs[0].text, !inside && edge === 'start' ? 'before ' : 'before');
        assert.equal(runs[1].text, inside ? (edge === 'start' ? ' code' : 'code ') : 'code');
        assert.equal(runs[2].text, !inside && edge === 'end' ? ' after' : 'after');
        assert.deepEqual(
          runs[1].marks.map((mark) => mark.type.name),
          ['code'],
        );
        assert.equal(runs[0].marks.length + runs[2].marks.length, 0);
        assertRoundTrip(editor);
      } finally {
        editor.destroy();
      }
    }
  }
});

test('code-only paragraphs accept spaces inside or outside either edge', () => {
  for (const edge of ['start', 'end'] as const) {
    for (const inside of [false, true]) {
      const { editor, cursor } = createEditor('`code`');
      try {
        const { from, to } = firstCodeRange(editor);
        editor.commands.setTextSelection(edge === 'start' ? from : to);
        press(editor, cursor, edge === 'start' ? 'ArrowLeft' : 'ArrowRight');
        if (inside) press(editor, cursor, edge === 'start' ? 'ArrowRight' : 'ArrowLeft');
        assert.equal(editor.isActive('code'), inside);
        editor.view.dispatch(editor.state.tr.insertText(' '));
        const runs = editor.state.doc.firstChild!.content.content;
        const inserted = edge === 'start' ? runs[0] : runs.at(-1)!;
        assert.equal(inserted.text, inside ? (edge === 'start' ? ' code' : 'code ') : ' ');
        assert.equal(
          inserted.marks.some((mark) => mark.type.name === 'code'),
          inside,
        );
        assertRoundTrip(editor);
      } finally {
        editor.destroy();
      }
    }
  }
});

test('the boundary decoration follows typing marks and disappears for ranges', () => {
  const { editor, cursor } = createEditor('before`code`after');
  try {
    const { to } = firstCodeRange(editor);
    editor.commands.setTextSelection(to);
    const decorations = () =>
      (cursor.props.decorations!.call(cursor, editor.state) as DecorationSet).find();
    const attributes = () =>
      (cursor.props.attributes as (state: Editor['state']) => Record<string, string>)(editor.state);
    assert.equal(decorations().length, 1);
    assert.equal(decorations()[0].from, to);
    assert.equal(decorations()[0].spec.side, -1);
    assert.equal(attributes().class, 'no-cursor');
    press(editor, cursor, 'ArrowRight');
    assert.equal(decorations()[0].from, to);
    assert.equal(decorations()[0].spec.side, 0);
    assert.equal(editor.isActive('code'), false);
    editor.commands.setTextSelection({ from: to - 2, to: to + 2 });
    assert.equal(decorations().length, 0);
    assert.equal(attributes().class, undefined);
  } finally {
    editor.destroy();
  }
});

test('navigation and code insertion preserve surrounding fonts and heading structure', () => {
  const source =
    '###### :font[**left**]{family="geo"}`code`:font[open-source]{family="jetbrains-mono"}';
  const { editor, cursor } = createEditor(source);
  try {
    const { from, to } = firstCodeRange(editor);
    editor.commands.setTextSelection(from - 1);
    step(editor, cursor, 1);
    assert.equal(editor.isActive('fontFamily', { font: 'geo' }), true);
    assert.equal(editor.isActive('bold'), true);
    editor.view.dispatch(editor.state.tr.insertText(' '));
    assert.equal(editor.state.doc.firstChild!.firstChild!.text, 'left ');
    editor.commands.setTextSelection(to + 2);
    step(editor, cursor, -1);
    step(editor, cursor, -1);
    assert.equal(editor.isActive('code'), true);
    editor.view.dispatch(editor.state.tr.insertText(' '));
    const block = editor.state.doc.firstChild!;
    assert.equal(block.type.name, 'heading');
    assert.equal(block.attrs.level, 6);
    assert.equal(block.child(1).text, 'code ');
    assert.deepEqual(
      block.child(1).marks.map((mark) => mark.type.name),
      ['code'],
    );
    assert.equal(block.lastChild!.text, 'open-source');
    assert.equal(block.lastChild!.marks[0].attrs.font, 'jetbrains-mono');
    assertRoundTrip(editor);
  } finally {
    editor.destroy();
  }
});

test('line navigation remains native and clears edge formatting on arrival', () => {
  for (const [key, options] of [
    ['ArrowRight', { metaKey: true }],
    ['End', {}],
    ['ArrowDown', {}],
  ] as const) {
    const { editor, cursor } = createEditor('before`code`');
    try {
      const { to } = firstCodeRange(editor);
      editor.commands.setTextSelection(to - 1);
      const doc = editor.state.doc;
      assert.equal(press(editor, cursor, key, options), false);
      editor.commands.setTextSelection(to);
      assert.equal(editor.isActive('code'), false);
      assert.strictEqual(editor.state.doc, doc);
    } finally {
      editor.destroy();
    }
  }
});

test('Option+Right stops inside code before adjacent text, then continues on the next press', () => {
  for (const source of [
    'before`code`after',
    'before`👩‍💻`after',
    '###### `code`:font[after]{family="jetbrains-mono"}',
  ]) {
    const { editor, cursor } = createEditor(source);
    try {
      const { from, to } = firstCodeRange(editor);
      editor.commands.setTextSelection(from);
      editor.view.dispatch(editor.state.tr.addStoredMark(editor.schema.marks.code.create()));
      const doc = editor.state.doc;
      assert.equal(press(editor, cursor, 'ArrowRight', { altKey: true }), false);
      // Supply the browser's destination for the joined code/plain-text word.
      editor.commands.setTextSelection(to + 5);
      assert.equal(editor.state.selection.head, to);
      assert.equal(editor.isActive('code'), true);
      assert.equal(cursor.getState(editor.state)?.side, -1);
      assert.strictEqual(editor.state.doc, doc);
      assert.equal(richDocumentToMarkdown(editor.getJSON(), source), source);

      assert.equal(press(editor, cursor, 'ArrowRight', { altKey: true }), false);
      editor.commands.setTextSelection(to + 5);
      assert.equal(editor.state.selection.head, to + 5);
      assert.equal(editor.isActive('code'), false);
      assert.strictEqual(editor.state.doc, doc);
    } finally {
      editor.destroy();
    }
  }
});

test('Option+Right preserves native word stops within code and typing at its end', () => {
  const { editor, cursor } = createEditor('before`one two`after');
  try {
    const { from, to } = firstCodeRange(editor);
    editor.commands.setTextSelection(from);
    editor.view.dispatch(editor.state.tr.addStoredMark(editor.schema.marks.code.create()));
    press(editor, cursor, 'ArrowRight', { altKey: true });
    editor.commands.setTextSelection(from + 3);
    assert.equal(editor.state.selection.head, from + 3);
    assert.equal(editor.isActive('code'), true);
    press(editor, cursor, 'ArrowRight', { altKey: true });
    editor.commands.setTextSelection(to + 5);
    assert.equal(editor.state.selection.head, to);
    editor.view.dispatch(editor.state.tr.insertText(' '));
    assert.equal(editor.state.doc.firstChild!.child(1).text, 'one two ');
    assert.equal(editor.state.doc.firstChild!.lastChild!.text, 'after');
    assertRoundTrip(editor);
  } finally {
    editor.destroy();
  }
});

test('word navigation guards do not change range selection, other modifiers, or outside-code movement', () => {
  const { editor, cursor } = createEditor('before`code`after');
  try {
    const { from, to } = firstCodeRange(editor);
    for (const options of [
      { altKey: true, shiftKey: true },
      { altKey: true, metaKey: true },
      { altKey: true, ctrlKey: true },
      { metaKey: true },
    ]) {
      editor.commands.setTextSelection(from + 1);
      press(editor, cursor, 'ArrowRight', options);
      editor.commands.setTextSelection(to + 5);
      assert.equal(editor.state.selection.head, to + 5);
    }
    editor.commands.setTextSelection({ from: from + 1, to: from + 2 });
    press(editor, cursor, 'ArrowRight', { altKey: true });
    editor.commands.setTextSelection(to + 5);
    assert.equal(editor.state.selection.head, to + 5);

    editor.commands.setTextSelection(from);
    editor.view.dispatch(editor.state.tr.removeStoredMark(editor.schema.marks.code));
    press(editor, cursor, 'ArrowRight', { altKey: true });
    editor.commands.setTextSelection(to + 5);
    assert.equal(editor.state.selection.head, to + 5);
  } finally {
    editor.destroy();
  }
});

test('pending word navigation cannot clamp a later click, focus change, composition, or edit', () => {
  const { editor, cursor } = createEditor('before`code`after');
  try {
    const { from, to } = firstCodeRange(editor);
    for (const type of ['pointerdown', 'blur', 'compositionstart'] as const) {
      editor.commands.setTextSelection(from + 1);
      press(editor, cursor, 'ArrowRight', { altKey: true });
      cursor.props.handleDOMEvents![type]!.call(cursor, editor.view, { type } as never);
      editor.commands.setTextSelection(to + 5);
      assert.equal(editor.state.selection.head, to + 5);
    }
    editor.commands.setTextSelection(from + 1);
    press(editor, cursor, 'ArrowRight', { altKey: true });
    press(editor, cursor, 'ArrowDown');
    editor.commands.setTextSelection(to + 5);
    assert.equal(editor.state.selection.head, to + 5);

    editor.commands.setTextSelection(from + 1);
    press(editor, cursor, 'ArrowRight', { altKey: true });
    editor.view.dispatch(editor.state.tr.insertText('X'));
    editor.commands.setTextSelection(to + 6);
    assert.equal(editor.state.selection.head, to + 6);
  } finally {
    editor.destroy();
  }
});

test('ordinary text, code blocks, and code interiors have no boundary cursor', () => {
  for (const source of ['ordinary text', '```\ncode\n```', '`longcode`']) {
    const { editor, cursor } = createEditor(source);
    try {
      editor.commands.setTextSelection(4);
      const { doc, selection } = editor.state;
      assert.equal(press(editor, cursor, 'ArrowRight'), false);
      assert.equal(press(editor, cursor, 'ArrowLeft'), false);
      assert.equal(cursor.getState(editor.state)?.active, undefined);
      assert.strictEqual(editor.state.doc, doc);
      assert.ok(editor.state.selection.eq(selection));
    } finally {
      editor.destroy();
    }
  }
});

test('the inherited code shortcut still formats and clears a selected range', () => {
  const source = 'Selected text';
  const { editor } = createEditor(source);
  try {
    editor.commands.setTextSelection({ from: 1, to: 9 });
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    const event = {
      key: 'e',
      keyCode: 69,
      code: 'KeyE',
      shiftKey: false,
      metaKey: mac,
      ctrlKey: !mac,
      altKey: false,
    } as KeyboardEvent;
    const shortcut = () =>
      editor.extensionManager.plugins.some((plugin) =>
        plugin.props.handleKeyDown?.call(plugin, editor.view, event),
      );
    assert.equal(shortcut(), true);
    assert.equal(richDocumentToMarkdown(editor.getJSON()), '`Selected` text\n');
    assert.equal(shortcut(), true);
    assert.equal(richDocumentToMarkdown(editor.getJSON(), source), source);
  } finally {
    editor.destroy();
  }
});

test('backtick input uses one code rule and retains undo-input-rule behavior', () => {
  const { editor } = createEditor('before `code');
  try {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const pos = editor.state.selection.from;
    const view = {
      state: editor.state,
      dispatch: (tr: Transaction) => editor.view.dispatch(tr),
      editable: true,
      composing: false,
    } as EditorView;
    const handled = editor.state.plugins.some((plugin) =>
      plugin.props.handleTextInput?.call(plugin, view, pos, pos, '`', () =>
        editor.state.tr.insertText('`', pos, pos),
      ),
    );
    assert.equal(handled, true);
    assert.equal(richDocumentToMarkdown(editor.getJSON()), 'before `code`\n');
    assert.equal(editor.isActive('code'), false);
    assert.equal(editor.commands.undoInputRule(), true);
    assert.equal(editor.state.doc.textContent, 'before `code`');
    assert.equal(
      editor.state.doc.rangeHasMark(1, editor.state.doc.content.size - 1, editor.schema.marks.code),
      false,
    );
  } finally {
    editor.destroy();
  }
});

test('boundary navigation is not recorded as document edits in undo history', () => {
  const source = 'before`code`after';
  const { editor, cursor } = createEditor(source);
  try {
    const { to } = firstCodeRange(editor);
    editor.commands.setTextSelection(to);
    press(editor, cursor, 'ArrowRight');
    editor.view.dispatch(editor.state.tr.insertText('X'));
    const changed = editor.state.doc;
    step(editor, cursor, -1);
    press(editor, cursor, 'ArrowLeft');
    assert.equal(editor.commands.undo(), true);
    assert.equal(richDocumentToMarkdown(editor.getJSON(), source), source);
    assert.equal(editor.commands.undo(), false);
    assert.equal(editor.commands.redo(), true);
    assert.ok(editor.state.doc.eq(changed));
  } finally {
    editor.destroy();
  }
});

test('Backspace delegates whole Unicode graphemes to native deletion at code edges', () => {
  for (const grapheme of ['🙂', '👩‍💻', 'e\u0301', '🇧🇷', 'क्‍ष']) {
    const { editor, cursor } = createEditor(`before\`a${grapheme}\`after`);
    try {
      const { to } = firstCodeRange(editor);
      editor.commands.setTextSelection(to);
      assert.equal(cursor.getState(editor.state)?.side, -1);
      const state = editor.state;
      assert.equal(press(editor, cursor, 'Backspace'), false, grapheme);
      assert.strictEqual(editor.state, state, 'the plugin must not delete one UTF-16 unit');
      assert.equal(editor.state.doc.textContent, `beforea${grapheme}after`);
    } finally {
      editor.destroy();
    }
  }
});

test('Backspace retains the code-edge deletion workaround for one-unit characters', () => {
  for (const character of ['x', '字']) {
    const { editor, cursor } = createEditor(`before\`a${character}\`after`);
    try {
      const { to } = firstCodeRange(editor);
      editor.commands.setTextSelection(to);
      assert.equal(press(editor, cursor, 'Backspace'), true);
      assert.equal(editor.state.doc.textContent, 'beforeaafter');
      assertRoundTrip(editor);
    } finally {
      editor.destroy();
    }
  }
});

test('code navigation and deletion do not interfere with composition or read-only views', () => {
  const { editor, cursor } = createEditor('before`code`after');
  try {
    const { to } = firstCodeRange(editor);
    editor.commands.setTextSelection(to);
    const state = editor.state;
    for (const key of ['ArrowRight', 'ArrowLeft', 'Backspace', 'Delete', '`']) {
      assert.equal(press(editor, cursor, key, { isComposing: true }), false);
      assert.equal(press(editor, cursor, key, {}, { composing: true }), false);
      assert.equal(press(editor, cursor, key, {}, { editable: false }), false);
      assert.strictEqual(editor.state, state);
    }
  } finally {
    editor.destroy();
  }
});
