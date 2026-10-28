import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, Selection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { ReplaceAroundStep } from '@tiptap/pm/transform';

/** Flatten legacy sections without reparsing their children or formatting their titles. */
export function migrateRichSections(state: EditorState): Transaction | null {
  const sections: { node: ProseMirrorNode; pos: number }[] = [];
  state.doc.forEach((node, pos) => {
    if (node.type.name === 'wyaSection') sections.push({ node, pos });
  });
  if (!sections.length) return null;

  const tr = state.tr;
  // Work backwards so each original position remains valid. The preserved gap
  // maps selections inside child blocks to those same blocks after the lift.
  for (const { node, pos } of sections.reverse()) {
    const title = typeof node.attrs.title === 'string' ? node.attrs.title : '';
    let prefix = title
      ? Fragment.from(state.schema.nodes.heading.create({ level: 3 }, state.schema.text(title)))
      : Fragment.empty;
    const needsParagraph = !prefix.size && !node.content.size && tr.doc.childCount === 1;
    if (needsParagraph) prefix = Fragment.from(state.schema.nodes.paragraph.create());
    tr.step(
      new ReplaceAroundStep(
        pos,
        pos + node.nodeSize,
        pos + 1,
        pos + node.nodeSize - 1,
        new Slice(prefix, 0, 0),
        prefix.size,
      ),
    );
    if (needsParagraph) tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)));
  }
  return tr;
}

/** Legacy HTML/JSON pastes become ordinary blocks in the same history event. */
export function createSectionMigration() {
  return Extension.create({
    name: 'sectionMigration',
    addProseMirrorPlugins: () => [
      new Plugin({
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          return migrateRichSections(state);
        },
      }),
    ],
  });
}

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
