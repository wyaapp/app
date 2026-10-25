import {
  Extension,
  InputRule,
  Mark,
  Node,
  nodeInputRule,
  type NodeViewRenderer,
} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image, { inputRegex as imageInputRegex } from '@tiptap/extension-image';
import { inlineFontId, inlineFontStyle } from './remark-fonts.ts';
import { RichCode } from './rich-document-code.ts';
import { normalizeImageEmbed } from './image.ts';
import { normalizeP5Embed } from './p5.ts';
import { gifSourceUrl, normalizeGifEmbed } from './gif.ts';
import { portableItemsSchema } from './portable-items.ts';
import type { LinkItem } from './profile-types.ts';
import { normalizeBadgeEmbed, parseBadgeUrl } from './badge.ts';

const MAX_CLIPBOARD_ATTRIBUTE = 128 * 1024;
const SECTION_CONTENT_SELECTOR = ':scope > [data-wya-section-content]';

function readPayload(element: HTMLElement, attribute: string): unknown {
  const value = element.getAttribute(attribute);
  if (!value || value.length > MAX_CLIPBOARD_ATTRIBUTE) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** HTML is untrusted even when it carries one of our clipboard markers. */
function clipboardItem(value: unknown): LinkItem | null {
  function withoutIdentity(value: unknown, nested = false): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const { id, sectionId: _sectionId, ...item } = value as Record<string, unknown>;
    void _sectionId;
    if (id !== undefined && (typeof id !== 'string' || !id || id.length > 100)) throw new Error();
    if (item.collection !== undefined) {
      const collection = item.collection as Record<string, unknown> | null;
      if (nested || !collection || !Array.isArray(collection.items) || collection.items.length > 20)
        throw new Error();
      item.collection = {
        ...collection,
        items: collection.items.map((child) => withoutIdentity(child, true)),
      };
    }
    return item;
  }
  function restoreIdentity(item: LinkItem, original: LinkItem): LinkItem {
    return {
      ...item,
      ...(original.id ? { id: original.id } : {}),
      ...(item.collection && original.collection
        ? {
            collection: {
              ...item.collection,
              items: item.collection.items.map((child, index) =>
                restoreIdentity(child, original.collection!.items[index]),
              ),
            },
          }
        : {}),
    };
  }
  try {
    const parsed = portableItemsSchema.safeParse([withoutIdentity(value)]);
    return parsed.success ? restoreIdentity(parsed.data[0] as LinkItem, value as LinkItem) : null;
  } catch {
    return null;
  }
}

function imageSize(value: string | null): number | 'full' | undefined | null {
  if (value === null) return undefined;
  if (value === 'full') return value;
  return /^[1-9][0-9]{0,3}$/.test(value) ? Number(value) : null;
}

function clipboardOrigin(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value || null
    : null;
}

const originAttribute = {
  default: null,
  rendered: false,
  parseHTML: (element: HTMLElement) => clipboardOrigin(element.getAttribute('data-wya-origin')),
};
const internalAttribute = { rendered: false, parseHTML: () => null };

function originHTML(value: unknown) {
  const origin = clipboardOrigin(value);
  return origin ? { 'data-wya-origin': origin } : {};
}

function preservedSource(element: HTMLElement, attribute: string) {
  const source = element.getAttribute(attribute);
  return source !== null && source.length <= MAX_CLIPBOARD_ATTRIBUTE ? { source } : false;
}

type RichDocumentViews = {
  card?: NodeViewRenderer;
  section?: NodeViewRenderer;
  opaque?: NodeViewRenderer;
  p5?: NodeViewRenderer;
  gif?: NodeViewRenderer;
  image?: NodeViewRenderer;
  badge?: NodeViewRenderer;
};

/** Shared by the editor and schema tests, with optional React presentation. */
export function createRichDocumentExtensions(views: RichDocumentViews = {}) {
  return [
    StarterKit.configure({
      document: false,
      trailingNode: false,
      code: false,
      dropcursor: { color: 'var(--ink)', width: 3, class: 'rich-native-dropcursor' },
      underline: false,
      link: { openOnClick: false, autolink: false },
    }),
    RichCode,
    Node.create({
      name: 'badge',
      priority: 1100,
      group: 'inline',
      inline: true,
      atom: true,
      draggable: true,
      addAttributes: () => ({ badge: { default: null, ...internalAttribute } }),
      parseHTML: () => [
        {
          tag: 'span[data-wya-badge]',
          getAttrs: (element) => {
            const badge = normalizeBadgeEmbed(readPayload(element, 'data-wya-badge'));
            return badge ? { badge } : false;
          },
        },
        {
          tag: 'a[href]',
          getAttrs: (element) => {
            const image = element.firstElementChild;
            if (
              element.children.length !== 1 ||
              image?.tagName !== 'IMG' ||
              element.textContent?.trim()
            )
              return false;
            const known = parseBadgeUrl(image.getAttribute('src') ?? '');
            const badge =
              known &&
              normalizeBadgeEmbed({
                ...known,
                alt: image.getAttribute('alt') ?? '',
                href: element.getAttribute('href'),
              });
            return badge ? { badge } : false;
          },
        },
        {
          tag: 'img[src]',
          getAttrs: (element) => {
            const known = parseBadgeUrl(element.getAttribute('src') ?? '');
            const badge =
              known && normalizeBadgeEmbed({ ...known, alt: element.getAttribute('alt') ?? '' });
            return badge ? { badge } : false;
          },
        },
      ],
      renderHTML: ({ node }) => {
        const badge = normalizeBadgeEmbed(node.attrs.badge);
        if (!badge) return ['span', {}, ''];
        const image = ['img', { src: badge.src, alt: badge.alt }] as const;
        return [
          'span',
          { 'data-wya-badge': JSON.stringify(badge) },
          badge.href ? ['a', { href: badge.href }, image] : image,
        ];
      },
      renderText: ({ node }) => {
        const badge = normalizeBadgeEmbed(node.attrs.badge);
        return badge?.alt || badge?.href || 'Badge';
      },
      ...(views.badge ? { addNodeView: () => views.badge! } : {}),
    }),
    Image.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          size: {
            default: null,
            parseHTML: (element) => imageSize(element.getAttribute('data-wya-image-size')),
            renderHTML: (attrs) =>
              attrs.size != null ? { 'data-wya-image-size': String(attrs.size) } : {},
          },
        };
      },
      parseHTML: () => [
        {
          tag: 'img[src]',
          getAttrs: (element) => {
            const size = imageSize(element.getAttribute('data-wya-image-size'));
            return size !== null &&
              normalizeImageEmbed({
                src: element.getAttribute('src'),
                alt: element.getAttribute('alt'),
                title: element.getAttribute('title'),
                size,
              })
              ? {}
              : false;
          },
        },
      ],
      renderText: ({ node }) => normalizeImageEmbed(node.attrs)?.src ?? '',
      addCommands() {
        return {
          setImage:
            (attributes) =>
            ({ commands }) => {
              const image = normalizeImageEmbed(attributes);
              return !!image && commands.insertContent({ type: this.name, attrs: image });
            },
        };
      },
      addInputRules() {
        const imageRule = nodeInputRule({
          find: imageInputRegex,
          type: this.type,
          getAttributes: (match) => {
            const [, , alt, src, title] = match;
            return { src, alt, title };
          },
        });
        return [
          new InputRule({
            find: imageInputRegex,
            handler: (props) => {
              const [, , alt, src, title] = props.match;
              if (!normalizeImageEmbed({ src, alt, title })) return null;
              return imageRule.handler(props);
            },
          }),
        ];
      },
      ...(views.image ? { addNodeView: () => views.image! } : {}),
    }).configure({ inline: false, allowBase64: false }),
    Mark.create({
      name: 'fontFamily',
      addAttributes: () => ({
        font: {
          default: null,
          rendered: false,
          parseHTML: (element) => inlineFontId(element.getAttribute('data-font-family')),
        },
      }),
      parseHTML: () => [
        {
          tag: 'span[data-font-family]',
          getAttrs: (element) =>
            inlineFontId(element.getAttribute('data-font-family')) ? {} : false,
        },
      ],
      renderHTML: ({ mark }) => {
        const font = inlineFontId(mark.attrs.font);
        return ['span', font ? { 'data-font-family': font, style: inlineFontStyle(font) } : {}, 0];
      },
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
      addAttributes: () => ({
        item: { default: null, ...internalAttribute },
        clipboardOrigin: originAttribute,
      }),
      parseHTML: () => [
        {
          tag: 'div[data-wya-card]',
          getAttrs: (element) => {
            const item = clipboardItem(readPayload(element, 'data-wya-card'));
            return item ? { item } : false;
          },
        },
      ],
      renderHTML: ({ node }) => {
        const item = clipboardItem(node.attrs.item);
        return [
          'div',
          {
            'data-wya-card': item ? JSON.stringify(item) : '',
            ...originHTML(node.attrs.clipboardOrigin),
          },
          item?.url ? ['a', { href: item.url }, item.label] : ['span', {}, item?.label ?? ''],
        ];
      },
      renderText: ({ node }) => {
        const item = clipboardItem(node.attrs.item);
        return item ? [item.label, item.url].filter(Boolean).join('\n') : '';
      },
      ...(views.card ? { addNodeView: () => views.card! } : {}),
    }),
    Node.create({
      name: 'wyaSection',
      group: 'section',
      content: '(block|wyaBlock)*',
      defining: true,
      isolating: true,
      addAttributes: () => ({
        id: { default: '', ...internalAttribute },
        title: { default: '', ...internalAttribute },
        clipboardOrigin: originAttribute,
      }),
      parseHTML: () => [
        {
          tag: 'section[data-wya-section]',
          contentElement: SECTION_CONTENT_SELECTOR,
          getAttrs: (element) => {
            const id = element.getAttribute('data-wya-section');
            const title = element.getAttribute('data-wya-section-title') ?? '';
            return id &&
              id.length <= 100 &&
              title.length <= 60 &&
              element.querySelector(SECTION_CONTENT_SELECTOR)
              ? { id, title }
              : false;
          },
        },
      ],
      renderHTML: ({ node }) => [
        'section',
        {
          'data-wya-section': node.attrs.id,
          'data-wya-section-title': node.attrs.title,
          ...originHTML(node.attrs.clipboardOrigin),
        },
        ['h2', {}, node.attrs.title],
        ['div', { 'data-wya-section-content': '' }, 0],
      ],
      ...(views.section ? { addNodeView: () => views.section! } : {}),
    }),
    Node.create({
      name: 'p5',
      group: 'block',
      atom: true,
      addAttributes: () => ({ sketch: { default: null, ...internalAttribute } }),
      parseHTML: () => [
        {
          tag: 'div[data-p5-embed]',
          getAttrs: (element) => {
            const raw = element.getAttribute('data-p5-embed');
            let value: unknown = null;
            try {
              if (raw && raw.length <= 256 * 1024) value = JSON.parse(raw);
            } catch {
              /* Invalid clipboard data stays inert. */
            }
            const sketch = normalizeP5Embed(value);
            return sketch ? { sketch } : false;
          },
        },
      ],
      renderHTML: ({ node }) => {
        const sketch = normalizeP5Embed(node.attrs.sketch);
        return [
          'div',
          { 'data-p5-embed': sketch ? JSON.stringify(sketch) : '' },
          sketch ? ['a', { href: sketch.url }, sketch.title || 'p5.js'] : '',
        ];
      },
      renderText: ({ node }) => normalizeP5Embed(node.attrs.sketch)?.url ?? '',
      ...(views.p5 ? { addNodeView: () => views.p5! } : {}),
    }),
    Node.create({
      name: 'gif',
      group: 'block',
      atom: true,
      addAttributes: () => ({ gif: { default: null, ...internalAttribute } }),
      parseHTML: () => [
        {
          tag: 'div[data-gif-embed]',
          getAttrs: (element) => {
            const gif = normalizeGifEmbed(readPayload(element, 'data-gif-embed'));
            return gif ? { gif } : false;
          },
        },
      ],
      renderHTML: ({ node }) => {
        const gif = normalizeGifEmbed(node.attrs.gif);
        return [
          'div',
          { 'data-gif-embed': gif ? JSON.stringify(gif) : '' },
          gif ? ['a', { href: gifSourceUrl(gif) }, gif.title || 'GIF'] : '',
        ];
      },
      renderText: ({ node }) => {
        const gif = normalizeGifEmbed(node.attrs.gif);
        return gif ? gifSourceUrl(gif) : '';
      },
      ...(views.gif ? { addNodeView: () => views.gif! } : {}),
    }),
    Node.create({
      name: 'markdownBlock',
      group: 'block',
      atom: true,
      addAttributes: () => ({ source: { default: '', ...internalAttribute } }),
      parseHTML: () => [
        {
          tag: 'pre[data-wya-markdown-block]',
          priority: 100,
          getAttrs: (element) => preservedSource(element, 'data-wya-markdown-block'),
        },
      ],
      renderHTML: ({ node }) => [
        'pre',
        { 'data-wya-markdown-block': node.attrs.source },
        node.attrs.source,
      ],
      renderText: ({ node }) => node.attrs.source,
      ...(views.opaque ? { addNodeView: () => views.opaque! } : {}),
    }),
    Node.create({
      name: 'markdownInline',
      group: 'inline',
      inline: true,
      atom: true,
      addAttributes: () => ({ source: { default: '', ...internalAttribute } }),
      parseHTML: () => [
        {
          tag: 'span[data-wya-markdown-inline]',
          getAttrs: (element) => preservedSource(element, 'data-wya-markdown-inline'),
        },
      ],
      renderHTML: ({ node }) => [
        'span',
        {
          class: 'rich-preserved-inline',
          contenteditable: 'false',
          'data-wya-markdown-inline': node.attrs.source,
        },
        node.attrs.source,
      ],
      renderText: ({ node }) => node.attrs.source,
    }),
    Extension.create({
      name: 'linkTitle',
      addGlobalAttributes: () => [{ types: ['link'], attributes: { title: { default: null } } }],
    }),
  ];
}
