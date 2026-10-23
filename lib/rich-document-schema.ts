import { Extension, Node, type NodeViewRenderer } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

type RichDocumentViews = {
  card?: NodeViewRenderer;
  section?: NodeViewRenderer;
  opaque?: NodeViewRenderer;
};

/** Shared by the editor and schema tests, with optional React presentation. */
export function createRichDocumentExtensions(views: RichDocumentViews = {}) {
  return [
    StarterKit.configure({
      document: false,
      trailingNode: false,
      underline: false,
      strike: false,
      link: { openOnClick: false, autolink: false },
    }),
    Node.create({
      name: 'doc',
      topNode: true,
      content: '(block|wyaBlock|section)+',
    }),
    Node.create({
      name: 'wyaItem',
      // Cards cannot be wrapped in ordinary blockquotes or list items.
      group: 'wyaBlock',
      atom: true,
      addAttributes: () => ({ item: { default: null } }),
      renderHTML: () => ['div', { 'data-wya-card': '' }],
      ...(views.card ? { addNodeView: () => views.card! } : {}),
    }),
    Node.create({
      name: 'wyaSection',
      group: 'section',
      content: '(block|wyaBlock)*',
      defining: true,
      isolating: true,
      addAttributes: () => ({ id: { default: '' }, title: { default: '' } }),
      renderHTML: () => ['section', { 'data-wya-section': '' }, 0],
      ...(views.section ? { addNodeView: () => views.section! } : {}),
    }),
    Node.create({
      name: 'markdownBlock',
      group: 'block',
      atom: true,
      addAttributes: () => ({ source: { default: '' } }),
      renderHTML: ({ node }) => ['pre', {}, node.attrs.source],
      ...(views.opaque ? { addNodeView: () => views.opaque! } : {}),
    }),
    Node.create({
      name: 'markdownInline',
      group: 'inline',
      inline: true,
      atom: true,
      addAttributes: () => ({ source: { default: '' } }),
      renderHTML: ({ node }) => [
        'span',
        { class: 'rich-preserved-inline', contenteditable: 'false' },
        node.attrs.source,
      ],
    }),
    Extension.create({
      name: 'linkTitle',
      addGlobalAttributes: () => [{ types: ['link'], attributes: { title: { default: null } } }],
    }),
  ];
}
