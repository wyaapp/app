import { normalizeP5Embed } from './p5.ts';
import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment, type Node as ProseMirrorNode, type Slice } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { gifSourceUrl, normalizeGifEmbed, parseGifUrl } from './gif.ts';
import { normalizeImageEmbed, parseImageUrl } from './image.ts';

export const mediaPasteKey = new PluginKey('richMediaPaste');

/** Only literal URLs (including the browser's single-link HTML) get expanded. */
function isSingleUrlSlice(slice: Slice, url: string): boolean {
  let content = slice.content;
  if (content.childCount === 1 && content.firstChild?.type.name === 'paragraph')
    content = content.firstChild.content;
  let valid = true;
  content.forEach((node) => {
    if (
      !node.isText ||
      node.marks.some((mark) => mark.type.name !== 'link' || mark.attrs.href !== url)
    )
      valid = false;
  });
  return valid && content.textBetween(0, content.size).trim() === url;
}

function linkParagraph(state: EditorState, url: string): ProseMirrorNode {
  const link = state.schema.marks.link;
  return state.schema.nodes.paragraph.create(
    null,
    state.schema.text(url, link ? [link.create({ href: url })] : []),
  );
}

export function mediaBlockUrl(node: ProseMirrorNode): string | null {
  if (node.type.name === 'p5') return normalizeP5Embed(node.attrs.sketch)?.url ?? null;
  if (node.type.name === 'image') return normalizeImageEmbed(node.attrs)?.src ?? null;
  if (node.type.name === 'gif') {
    const gif = normalizeGifEmbed(node.attrs.gif);
    return gif ? gifSourceUrl(gif) : null;
  }
  return null;
}

/** Replace just this media block. Undo restores it, including its chosen size. */
export function mediaBlockToLink(state: EditorState, pos: number): Transaction | null {
  if (!Number.isInteger(pos) || pos < 0 || pos >= state.doc.content.size) return null;
  const node = state.doc.nodeAt(pos);
  const url = node && mediaBlockUrl(node);
  if (!node || !url) return null;
  const paragraph = linkParagraph(state, url);
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.canReplace($pos.index(), $pos.index() + 1, Fragment.from(paragraph)))
    return null;
  const tr = closeHistory(state.tr).replaceWith(pos, pos + node.nodeSize, paragraph);
  return tr
    .setSelection(TextSelection.create(tr.doc, pos + 1 + url.length))
    .setStoredMarks(null)
    .scrollIntoView();
}

export function createMediaPaste() {
  return Extension.create({
    name: 'richMediaPaste',
    priority: 1100,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: mediaPasteKey,
          props: {
            handlePaste(view, event, slice) {
              if (!view.editable || view.composing || !event.clipboardData) return false;
              if (event.clipboardData.files.length) return false;
              const url = event.clipboardData.getData('text/plain').trim();
              const { state } = view;
              const { selection } = state;
              if (
                !(selection instanceof TextSelection) ||
                !selection.empty ||
                selection.$from.parent.type.name !== 'paragraph' ||
                selection.$from.parent.content.size !== 0 ||
                (state.storedMarks ?? selection.$from.marks()).some(
                  (mark) => mark.type.spec.code,
                ) ||
                !isSingleUrlSlice(slice, url)
              )
                return false;

              const gif = parseGifUrl(url);
              const image = gif ? null : parseImageUrl(url);
              const media = gif
                ? state.schema.nodes.gif?.create({ gif: { ...gif, sourceUrl: url } })
                : image
                  ? state.schema.nodes.image?.create(image)
                  : null;
              if (!media) return false;
              const pos = selection.$from.before();
              const end = selection.$from.after();
              const $pos = state.doc.resolve(pos);
              const index = $pos.index();
              // List items require their first child to remain a paragraph.
              // Let native paste handle any parent that cannot contain this block.
              if (!$pos.parent.canReplace(index, index + 1, Fragment.from(media))) return false;
              const next = $pos.parent.maybeChild(index + 1);
              const reuseNext = next?.type.name === 'paragraph' && next.content.size === 0;
              const replacement = Fragment.fromArray(
                reuseNext ? [media] : [media, state.schema.nodes.paragraph.create()],
              );
              if (!$pos.parent.canReplace(index, index + 1, replacement)) return false;

              // Keep the literal paste as its own history step, then expand it.
              // One Undo recovers the link; a second Undo removes the paste.
              const paragraph = linkParagraph(state, url);
              const pasted = closeHistory(state.tr).replaceWith(pos, end, paragraph);
              pasted.setSelection(TextSelection.create(pasted.doc, pos + 1 + url.length));
              pasted.setStoredMarks(null);
              view.dispatch(pasted);
              // A synchronous external editor change must never be overwritten.
              if (!view.state.doc.eq(pasted.doc)) return true;
              const expanded = closeHistory(view.state.tr).replaceWith(
                pos,
                pos + paragraph.nodeSize,
                replacement,
              );
              expanded
                .setSelection(TextSelection.create(expanded.doc, pos + media.nodeSize + 1))
                .setStoredMarks(null);
              view.dispatch(expanded.scrollIntoView());
              view.dispatch(closeHistory(view.state.tr));
              return true;
            },
          },
        }),
      ];
    },
  });
}
