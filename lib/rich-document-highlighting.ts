import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { highlightCode, normalizeCodeLanguage, type SyntaxToken } from './syntax-highlighting.ts';

type CodeBlock = {
  node: ProseMirrorNode;
  position: number;
  tokens?: readonly SyntaxToken[] | null;
};
type HighlightState = { blocks: CodeBlock[]; decorations: DecorationSet };
type HighlightResult = { node: ProseMirrorNode; tokens: readonly SyntaxToken[] | null };
type Highlighter = typeof highlightCode;

export const richCodeHighlightingKey = new PluginKey<HighlightState>('richCodeHighlighting');

function blocksIn(doc: ProseMirrorNode, previous: readonly CodeBlock[] = []): CodeBlock[] {
  const known = new Map(previous.map((block) => [block.node, block.tokens]));
  const blocks: CodeBlock[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== 'codeBlock') return;
    if (normalizeCodeLanguage(node.attrs.language))
      blocks.push({ node, position, tokens: known.get(node) });
    return false;
  });
  return blocks;
}

function decorated(
  doc: ProseMirrorNode,
  blocks: CodeBlock[],
  pendingColors: DecorationSet = DecorationSet.empty,
): HighlightState {
  const decorations: Decoration[] = [];
  for (const block of blocks) {
    if (block.tokens === undefined) {
      // Preserve mapped colors while an edit is being tokenized, avoiding a flash
      // of plain text on every keystroke. New results replace them atomically.
      const from = block.position + 1;
      const to = from + block.node.content.size;
      decorations.push(
        ...pendingColors.find(from, to).filter((span) => span.from >= from && span.to <= to),
      );
      continue;
    }
    for (const token of block.tokens ?? []) {
      if (token.from < 0 || token.to <= token.from || token.to > block.node.content.size) continue;
      decorations.push(
        Decoration.inline(block.position + 1 + token.from, block.position + 1 + token.to, {
          style: `color: ${token.color}`,
        }),
      );
    }
  }
  return { blocks, decorations: DecorationSet.create(doc, decorations) };
}

/** Highlighting is presentation state: it never rewrites code, selection or Markdown. */
export function richCodeHighlightingPlugin(highlight: Highlighter = highlightCode) {
  let pause = () => {};
  let resume = () => {};
  return new Plugin<HighlightState>({
    key: richCodeHighlightingKey,
    state: {
      init: (_config, state) => decorated(state.doc, blocksIn(state.doc)),
      apply(transaction, previous) {
        const results = transaction.getMeta(richCodeHighlightingKey) as
          readonly HighlightResult[] | undefined;
        if (!transaction.docChanged && !results) return previous;
        let blocks = transaction.docChanged
          ? blocksIn(transaction.doc, previous.blocks)
          : previous.blocks;
        if (results) {
          const tokens = new Map(results.map((result) => [result.node, result.tokens]));
          blocks = blocks.map((block) =>
            tokens.has(block.node) ? { ...block, tokens: tokens.get(block.node) } : block,
          );
        }
        return decorated(
          transaction.doc,
          blocks,
          transaction.docChanged
            ? previous.decorations.map(transaction.mapping, transaction.doc)
            : previous.decorations,
        );
      },
    },
    props: {
      decorations: (state) => richCodeHighlightingKey.getState(state)?.decorations,
      handleDOMEvents: {
        compositionstart() {
          pause();
          return false;
        },
        compositionend() {
          resume();
          return false;
        },
      },
    },
    view(view) {
      let destroyed = false;
      let composing = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const requested = new WeakSet<ProseMirrorNode>();
      const completed = new WeakMap<ProseMirrorNode, readonly SyntaxToken[] | null>();
      const pending = new Map<ProseMirrorNode, HighlightResult>();

      function flush() {
        if (destroyed || composing || view.composing || !pending.size) return;
        const current = new Set(
          richCodeHighlightingKey.getState(view.state)?.blocks.map((block) => block.node),
        );
        const results = [...pending.values()].filter((result) => current.has(result.node));
        pending.clear();
        if (!results.length) return;
        view.dispatch(
          view.state.tr
            .setMeta(richCodeHighlightingKey, results)
            .setMeta('addToHistory', false)
            .setMeta('preventUpdate', true),
        );
      }

      function run() {
        timer = undefined;
        if (destroyed || composing) return;
        if (view.composing) {
          schedule(100);
          return;
        }
        flush();
        for (const block of richCodeHighlightingKey.getState(view.state)?.blocks ?? []) {
          if (block.tokens !== undefined || requested.has(block.node)) continue;
          if (completed.has(block.node)) {
            pending.set(block.node, { node: block.node, tokens: completed.get(block.node)! });
            continue;
          }
          requested.add(block.node);
          void Promise.resolve()
            .then(() => highlight(block.node.textContent, block.node.attrs.language))
            .catch(() => null)
            .then((tokens) => {
              if (destroyed) return;
              requested.delete(block.node);
              completed.set(block.node, tokens);
              pending.set(block.node, { node: block.node, tokens });
              // Several blocks can finish together without one transaction per block.
              queueMicrotask(flush);
            });
        }
        flush();
      }

      function schedule(delay: number) {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(run, delay);
      }
      pause = () => {
        composing = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      };
      resume = () => {
        composing = false;
        // Let ProseMirror finish its composition cleanup before decorating text.
        schedule(100);
      };
      schedule(0);
      return {
        update(nextView: EditorView, previousState: EditorState) {
          view = nextView;
          if (
            richCodeHighlightingKey.getState(previousState) ===
            richCodeHighlightingKey.getState(view.state)
          )
            return;
          schedule(previousState.doc === view.state.doc ? 0 : 100);
        },
        destroy() {
          destroyed = true;
          if (timer !== undefined) clearTimeout(timer);
          pending.clear();
          pause = resume = () => {};
        },
      };
    },
  });
}

export function createRichCodeHighlighting() {
  return Extension.create({
    name: 'richCodeHighlighting',
    addProseMirrorPlugins: () => [richCodeHighlightingPlugin()],
  });
}
