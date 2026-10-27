import { closeHistory } from '@tiptap/pm/history';
import { Fragment } from '@tiptap/pm/model';
import { Selection, type EditorState, type Transaction } from '@tiptap/pm/state';

/** Remove only the section wrapper, keeping every child and its identity in place. */
export function unwrapRichSection(state: EditorState, pos: number): Transaction | null {
  if (!Number.isInteger(pos) || pos < 0 || pos >= state.doc.content.size) return null;
  const at = state.doc.resolve(pos);
  const section = at.nodeAfter;
  if (!section || section.type.name !== 'wyaSection') return null;
  let content = section.content;
  // A document always needs an editable block, including after its last empty section.
  if (!content.size && at.parent.type.name === 'doc' && at.parent.childCount === 1)
    content = Fragment.from(state.schema.nodes.paragraph.create());
  if (!at.parent.canReplace(at.index(), at.index() + 1, content)) return null;
  const tr = closeHistory(state.tr).replaceWith(pos, pos + section.nodeSize, content);
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
  return tr.scrollIntoView();
}
