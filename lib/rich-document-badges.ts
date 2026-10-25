import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { normalizeBadgeEmbed, parseBadgeInput, parseBadgeUrl, type BadgeEmbed } from './badge.ts';
import { insertRichBlock, type RichInsertionOptions } from './rich-document-insertion.ts';

export const badgePasteKey = new PluginKey('richBadgePaste');

/** Badges live in text, so adjacent badges naturally share a wrapping line. */
export function insertRichBadge(
  state: EditorState,
  value: BadgeEmbed,
  options: RichInsertionOptions = {},
) {
  const badge = normalizeBadgeEmbed(value);
  const type = state.schema.nodes.badge;
  if (!badge || !type) return null;
  const node = type.create({ badge });
  if (options.pos !== undefined) {
    const paragraph = state.schema.nodes.paragraph.create(null, node);
    const tr = insertRichBlock(state, paragraph, options);
    return (
      tr?.setSelection(TextSelection.create(tr.doc, tr.selection.from + node.nodeSize)) ?? null
    );
  }
  const { from, to } = options.range ?? state.selection;
  if (from < 0 || to < from || to > state.doc.content.size) return null;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (
    !$from.sameParent($to) ||
    !$from.parent.inlineContent ||
    $from.parent.type.spec.code ||
    (state.storedMarks ?? $from.marks()).some((mark) => mark.type.spec.code) ||
    !$from.parent.canReplaceWith($from.index(), $to.index(), type)
  )
    return null;
  const tr = closeHistory(state.tr).replaceWith(from, to, node);
  return tr
    .setSelection(TextSelection.create(tr.doc, from + node.nodeSize))
    .setStoredMarks(null)
    .scrollIntoView();
}

/** Known badge image addresses paste inline, without a proxy or a metadata request. */
export function createBadgePaste() {
  return Extension.create({
    name: 'richBadgePaste',
    priority: 1150,
    addProseMirrorPlugins: () => [
      new Plugin({
        key: badgePasteKey,
        props: {
          handlePaste(view, event, slice) {
            if (!view.editable || view.composing || !event.clipboardData) return false;
            if (event.clipboardData.files.length) return false;
            const { state } = view;
            if (!(state.selection instanceof TextSelection) || !state.selection.empty) return false;
            if (
              (state.storedMarks ?? state.selection.$from.marks()).some(
                (mark) => mark.type.spec.code,
              )
            )
              return false;
            const input = event.clipboardData.getData('text/plain').trim();
            const badge = parseBadgeUrl(input) ?? parseBadgeInput(input);
            if (!badge || !parseBadgeUrl(badge.src)) return false;
            // Rich content already parsed by the schema must follow normal paste.
            let literal = true;
            slice.content.descendants((node) => {
              if (!node.isText && node.type.name !== 'paragraph') literal = false;
              if (node.marks.some((mark) => mark.type.name !== 'link')) literal = false;
            });
            if (!literal || slice.content.textBetween(0, slice.content.size).trim() !== input)
              return false;
            const tr = insertRichBadge(state, badge);
            if (!tr) return false;
            view.dispatch(tr.setMeta('paste', true).setMeta('uiEvent', 'paste'));
            view.dispatch(closeHistory(view.state.tr));
            return true;
          },
        },
      }),
    ],
  });
}
