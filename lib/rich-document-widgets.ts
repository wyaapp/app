import { Extension, type JSONContent } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { richDocumentToMarkdown } from './rich-document.ts';
import { parseWidgetSource } from './widget-files.ts';

export const WIDGET_BLOCK_CHOICES = new Set(['discord', 'gif', 'p5', 'codeBlock']);
export const WIDGET_EDITOR_ERROR =
  'Widgets contain one Discord, GIF, p5.js or code block. Convert to Markdown to add more content.';

/** Serialize a copy without tying its card identity to the source document. */
export function richBlockWidgetSource(node: JSONContent): string | null {
  if (!['wyaItem', 'gif', 'p5', 'codeBlock'].includes(node.type ?? '')) return null;
  if (node.type === 'wyaItem') {
    const { id: _id, sectionId: _sectionId, ...item } = node.attrs?.item ?? {};
    void _id;
    void _sectionId;
    node = { ...node, attrs: { item } };
  }
  try {
    const source = richDocumentToMarkdown({ type: 'doc', content: [node] }, undefined, {
      wya: true,
    });
    return parseWidgetSource(source, { allowEmpty: false }) ? source : null;
  } catch {
    return null;
  }
}

/** Guard all editing paths, including native paste/drop, keyboard commands and undo. */
export function widgetDocumentConstraint(onReject: () => void = () => {}) {
  return new Plugin({
    filterTransaction(transaction) {
      if (!transaction.docChanged) return true;
      try {
        const source = richDocumentToMarkdown(transaction.doc.toJSON(), undefined, { wya: true });
        parseWidgetSource(source);
        return true;
      } catch {
        onReject();
        return false;
      }
    },
  });
}

export function createWidgetDocumentConstraint(onReject: () => void) {
  return Extension.create({
    name: 'widgetDocumentConstraint',
    addProseMirrorPlugins: () => [widgetDocumentConstraint(onReject)],
  });
}
