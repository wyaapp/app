import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { AllSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { fontIds, profileFonts, type ProfileFont } from './profile-fonts.ts';

export type RichFontDefaults = { bodyFont?: ProfileFont; headingFont?: ProfileFont };
export type RichFontSelection = {
  /** Null for a mixed selection, rather than claiming the first character's font. */
  font: ProfileFont | null;
  inherited: boolean;
  mixed: boolean;
  enabled: boolean;
};

function isFont(value: unknown): value is ProfileFont {
  return typeof value === 'string' && fontIds.some((font) => font === value);
}

function acceptsFont(state: EditorState, parent: ProseMirrorNode, marks: readonly Mark[]) {
  const type = state.schema.marks.fontFamily;
  return (
    !!type &&
    parent.isTextblock &&
    !parent.type.spec.code &&
    parent.type.allowsMarkType(type) &&
    !marks.some((mark) => mark.type.spec.code)
  );
}

/** The font indicator follows every selected text run, including inherited defaults. */
export function getRichFontSelection(
  state: EditorState,
  defaults: RichFontDefaults = {},
): RichFontSelection {
  const { selection } = state;
  const result: RichFontSelection = {
    font: null,
    inherited: true,
    mixed: false,
    enabled: false,
  };
  if (!(selection instanceof TextSelection || selection instanceof AllSelection)) return result;
  let face: string | undefined;
  function inspect(parent: ProseMirrorNode, marks: readonly Mark[]) {
    const code = parent.type.spec.code || marks.some((mark) => mark.type.spec.code);
    const override = marks.find((mark) => mark.type.name === 'fontFamily')?.attrs.font;
    const inherited = !isFont(override);
    const role = parent.type.name === 'heading' ? 'heading' : 'body';
    const fallback = role === 'heading' ? defaults.headingFont : defaults.bodyFont;
    const font = code ? 'mono' : isFont(override) ? override : (fallback ?? 'original');
    const stack = profileFonts[font][role];
    if (face === undefined) {
      face = stack;
      result.font = font;
    } else if (face !== stack) {
      result.font = null;
      result.mixed = true;
    }
    result.inherited &&= inherited;
    result.enabled ||= acceptsFont(state, parent, marks);
  }
  if (selection.empty) {
    inspect(selection.$from.parent, state.storedMarks ?? selection.$from.marks());
  } else {
    state.doc.nodesBetween(selection.from, selection.to, (node, pos, parent) => {
      if (node.isText && parent && pos < selection.to && pos + node.nodeSize > selection.from)
        inspect(parent, node.marks);
      return !node.isAtom;
    });
  }
  return result;
}

/** Apply or clear an override without reconstructing blocks or replacing other marks. */
export function richFontTransaction(
  state: EditorState,
  font: ProfileFont | null,
  snapshot?: EditorState,
): Transaction | null {
  const type = state.schema.marks.fontFamily;
  if (!type || (font !== null && !isFont(font))) return null;
  // A picker may move DOM focus, but must not apply an old selection to edited text.
  if (snapshot && snapshot.doc !== state.doc) return null;
  const tr = state.tr;
  if (snapshot) {
    tr.setSelection(snapshot.selection);
    if (snapshot.selection.empty) tr.setStoredMarks(snapshot.storedMarks);
  }
  const { selection } = tr;
  if (!(selection instanceof TextSelection || selection instanceof AllSelection)) return null;
  if (selection.empty) {
    const marks = tr.storedMarks ?? selection.$from.marks();
    if (!acceptsFont(state, selection.$from.parent, marks)) return null;
    return font === null ? tr.removeStoredMark(type) : tr.addStoredMark(type.create({ font }));
  }
  let eligible = false;
  state.doc.nodesBetween(selection.from, selection.to, (node, pos, parent) => {
    if (node.isText && parent && acceptsFont(state, parent, node.marks)) {
      const from = Math.max(pos, selection.from);
      const to = Math.min(pos + node.nodeSize, selection.to);
      if (from < to) {
        eligible = true;
        if (font === null) tr.removeMark(from, to, type);
        else tr.addMark(from, to, type.create({ font }));
      }
    }
    return !node.isAtom;
  });
  return eligible ? closeHistory(tr) : null;
}

export function setRichFont(editor: Editor, font: ProfileFont | null, snapshot?: EditorState) {
  // Tiptap reports an unmounted, headless editor as destroyed even while its
  // schema and commands remain usable. An actually destroyed editor clears it.
  if (!editor.schema || !editor.isEditable) return false;
  const tr = richFontTransaction(editor.state, font, snapshot);
  if (!tr) return false;
  editor.view.dispatch(tr);
  return true;
}
