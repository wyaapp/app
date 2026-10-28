import type { JSONContent } from '@tiptap/core';
import type { Nodes, PhrasingContent, Root, RootContent } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import { remarkStrikethrough } from './remark-strikethrough.ts';
import { AppError } from './app-error.ts';
import { flattenMarkdownSections } from './markdown-sections.ts';
import {
  pageDirectiveItem,
  pageDirectiveSection,
  parsePageTree,
  restoreMarkdownText,
  serializePageItem,
  stringifyPageTree,
  type PageSourceOptions,
} from './page-documents.ts';
import type { LinkItem } from './profile-types.ts';
import { badgeFromMarkdownNode, badgeMarkdownNode, type BadgeEmbed } from './badge.ts';
import { parseP5Node, p5MarkdownNode, type P5Embed } from './p5.ts';
import { gifDirectiveNode, parseGifDirective, type GifEmbed } from './gif.ts';
import { inlineFontId, parseFontDirective } from './remark-fonts.ts';
import {
  imageMarkdownNode,
  normalizeImageEmbed,
  parseImageDirective,
  type ImageEmbed,
} from './image.ts';

export type RichDocumentOptions = PageSourceOptions & {
  wya?: boolean;
  /** The file editor retires legacy section containers as ordinary Markdown headings. */
  sectionsAsHeadings?: boolean;
};

const markdownParser = unified().use(remarkParse).use(remarkDirective).use(remarkStrikethrough);
const marksOrder = ['fontFamily', 'link', 'bold', 'italic', 'strike', 'code'];

function unsupported(): never {
  throw new AppError('This formatting is not supported in Markdown.');
}

function sourceText(node: Nodes, source: string): string {
  return source.slice(node.position!.start.offset!, node.position!.end.offset!);
}

function text(value: string, marks: NonNullable<JSONContent['marks']> = []): JSONContent[] {
  return value ? [{ type: 'text', text: value, ...(marks.length ? { marks } : {}) }] : [];
}

/**
 * Convert Markdown to a schema-safe editing document. Unsupported constructs become
 * inert nodes containing their original source instead of being discarded by ProseMirror.
 */
export function markdownToRichDocument(
  source: string,
  options: RichDocumentOptions = {},
): JSONContent {
  if (options.wya !== false && options.sectionsAsHeadings)
    source = flattenMarkdownSections(source, options);
  const tree =
    options.wya === false ? markdownParser.parse(source) : parsePageTree(source, options);
  if (options.wya === false) restoreMarkdownText(tree, source);

  function inline(
    nodes: readonly Nodes[],
    marks: NonNullable<JSONContent['marks']> = [],
  ): JSONContent[] {
    return nodes.flatMap((node): JSONContent[] => {
      const badge = badgeFromMarkdownNode(node);
      if (badge) return [{ type: 'badge', attrs: { badge } }];
      const font = parseFontDirective(node);
      if (font && node.type === 'textDirective')
        return inline(node.children, [
          ...marks.filter((mark) => mark.type !== 'fontFamily'),
          { type: 'fontFamily', attrs: { font } },
        ]);
      switch (node.type) {
        case 'text':
          return text(node.value, marks);
        case 'strong':
          return inline(node.children, [...marks, { type: 'bold' }]);
        case 'emphasis':
          return inline(node.children, [...marks, { type: 'italic' }]);
        case 'delete':
          return inline(node.children, [...marks, { type: 'strike' }]);
        case 'inlineCode':
          // Code keeps its fixed typography; its schema excludes font marks.
          return text(node.value, [
            ...marks.filter((mark) => mark.type !== 'fontFamily'),
            { type: 'code' },
          ]);
        case 'link':
          return inline(node.children, [
            ...marks,
            { type: 'link', attrs: { href: node.url, title: node.title ?? null } },
          ]);
        case 'break':
          return [{ type: 'hardBreak', ...(marks.length ? { marks } : {}) }];
        default:
          return [
            {
              type: 'markdownInline',
              attrs: { source: sourceText(node, source) },
              ...(marks.length ? { marks } : {}),
            },
          ];
      }
    });
  }

  function block(node: Nodes): JSONContent {
    const sketch = parseP5Node(node);
    if (sketch) return { type: 'p5', attrs: { sketch } };
    const gif = parseGifDirective(node);
    if (gif) return { type: 'gif', attrs: { gif } };
    const image = parseImageDirective(node);
    if (image) return { type: 'image', attrs: image };
    if (options.wya !== false) {
      const item = pageDirectiveItem(node);
      if (item) return { type: 'wyaItem', attrs: { item } };
      const section = pageDirectiveSection(node);
      if (section && node.type === 'containerDirective')
        return {
          type: 'wyaSection',
          attrs: section,
          content: node.children
            .filter((child) => !(child.type === 'paragraph' && child.data?.directiveLabel))
            .map(block),
        };
    }
    switch (node.type) {
      case 'paragraph': {
        if (
          node.children.length === 1 &&
          node.children[0].type === 'image' &&
          !badgeFromMarkdownNode(node.children[0])
        ) {
          const { url, alt, title } = node.children[0];
          const image = normalizeImageEmbed({ src: url, alt, title });
          if (image) return { type: 'image', attrs: image };
        }
        return { type: 'paragraph', content: inline(node.children) };
      }
      case 'heading':
        return { type: 'heading', attrs: { level: node.depth }, content: inline(node.children) };
      case 'thematicBreak':
        return { type: 'horizontalRule' };
      case 'blockquote':
        return { type: 'blockquote', content: node.children.map(block) };
      case 'list':
        return {
          type: node.ordered ? 'orderedList' : 'bulletList',
          ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}),
          content: node.children.map(block),
        };
      case 'listItem': {
        const content = node.children.map(block);
        // StarterKit requires an initial paragraph, even when Markdown starts with code/quote.
        if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' });
        return { type: 'listItem', content };
      }
      case 'code':
        if (!node.meta)
          return {
            type: 'codeBlock',
            attrs: { language: node.lang ?? null },
            content: text(node.value),
          };
        break;
    }
    return { type: 'markdownBlock', attrs: { source: sourceText(node, source) } };
  }

  return {
    type: 'doc',
    content: tree.children.length ? tree.children.map(block) : [{ type: 'paragraph' }],
  };
}

function sameInlineContainer(left: PhrasingContent, right: PhrasingContent): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'strong' || left.type === 'emphasis' || left.type === 'delete') return true;
  if (left.type === 'textDirective' && right.type === 'textDirective')
    return (
      Boolean(parseFontDirective(left)) && parseFontDirective(left) === parseFontDirective(right)
    );
  return (
    left.type === 'link' &&
    right.type === 'link' &&
    left.url === right.url &&
    left.title === right.title
  );
}

function mergeInline(nodes: PhrasingContent[]): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  for (const node of nodes) {
    const previous = result.at(-1);
    if (previous?.type === 'text' && node.type === 'text') previous.value += node.value;
    else if (previous?.type === 'inlineCode' && node.type === 'inlineCode')
      previous.value += node.value;
    else if (
      previous &&
      sameInlineContainer(previous, node) &&
      'children' in previous &&
      'children' in node
    )
      previous.children = mergeInline([...previous.children, ...node.children]);
    else result.push(node);
  }
  return result;
}

function richTree(document: JSONContent, options: RichDocumentOptions): Root {
  // Empty paragraphs outside list items are caret positions, not Markdown content.
  // Keep paragraphs with whitespace or hard breaks, and preserve actual empty list items.
  function blocks(nodes: JSONContent[] = []): RootContent[] {
    return nodes
      .filter((node) => node.type !== 'paragraph' || (node.content?.length ?? 0) > 0)
      .map(block);
  }

  function inline(nodes: JSONContent[] = []): PhrasingContent[] {
    return mergeInline(
      nodes.map((node): PhrasingContent => {
        let value: PhrasingContent;
        const marks = [...(node.marks ?? [])];
        if (marks.some((mark) => !marksOrder.includes(mark.type))) unsupported();
        switch (node.type) {
          case 'badge':
            return badgeMarkdownNode(node.attrs?.badge as BadgeEmbed);
          case 'text':
            value = marks.some((mark) => mark.type === 'code')
              ? { type: 'inlineCode', value: node.text ?? '' }
              : { type: 'text', value: node.text ?? '' };
            break;
          case 'hardBreak':
            value = { type: 'break' };
            break;
          case 'markdownInline':
            value = { type: 'html', value: String(node.attrs?.source ?? '') };
            break;
          default:
            unsupported();
        }
        marks.sort((a, b) => marksOrder.indexOf(a.type) - marksOrder.indexOf(b.type));
        for (const mark of marks.reverse()) {
          if (mark.type === 'fontFamily') {
            const font = inlineFontId(mark.attrs?.font);
            if (!font) unsupported();
            value = {
              type: 'textDirective',
              name: 'font',
              attributes: { family: font },
              children: [value],
            };
          } else if (mark.type === 'bold') value = { type: 'strong', children: [value] };
          else if (mark.type === 'italic') value = { type: 'emphasis', children: [value] };
          else if (mark.type === 'strike') value = { type: 'delete', children: [value] };
          else if (mark.type === 'link')
            value = {
              type: 'link',
              url: String(mark.attrs?.href ?? ''),
              title: mark.attrs?.title ?? null,
              children: [value],
            };
        }
        return value;
      }),
    );
  }

  function block(node: JSONContent): RootContent {
    const content = node.content ?? [];
    switch (node.type) {
      case 'p5':
        return p5MarkdownNode(node.attrs?.sketch as P5Embed);
      case 'gif':
        return gifDirectiveNode(node.attrs?.gif as GifEmbed);
      case 'image':
        return imageMarkdownNode(node.attrs as ImageEmbed);
      case 'paragraph':
        return { type: 'paragraph', children: inline(content) };
      case 'heading': {
        const depth = Number(node.attrs?.level ?? 1);
        if (![1, 2, 3, 4, 5, 6].includes(depth)) unsupported();
        return {
          type: 'heading',
          depth: depth as 1 | 2 | 3 | 4 | 5 | 6,
          children: inline(content),
        };
      }
      case 'horizontalRule':
        return { type: 'thematicBreak' };
      case 'codeBlock':
        if (content.some((child) => child.type !== 'text')) unsupported();
        return {
          type: 'code',
          lang: node.attrs?.language ?? null,
          value: content.map((child) => child.text ?? '').join(''),
        };
      case 'blockquote':
        return {
          type: 'blockquote',
          children: blocks(content) as Extract<Nodes, { type: 'blockquote' }>['children'],
        };
      case 'bulletList':
      case 'orderedList':
        return {
          type: 'list',
          ordered: node.type === 'orderedList',
          start: node.type === 'orderedList' ? Number(node.attrs?.start ?? 1) : null,
          spread: false,
          children: content.map((child) => {
            if (child.type !== 'listItem') unsupported();
            return {
              type: 'listItem',
              spread: false,
              children: (child.content ?? []).map(block) as Extract<
                Nodes,
                { type: 'listItem' }
              >['children'],
            };
          }),
        };
      case 'wyaItem':
        if (options.wya === false) unsupported();
        return {
          type: 'html',
          value: serializePageItem(node.attrs?.item as LinkItem, { preserveIdOmission: true }),
        };
      case 'wyaSection':
        if (options.wya === false) unsupported();
        return {
          type: 'containerDirective',
          name: 'section',
          attributes: { id: String(node.attrs?.id ?? '') },
          children: [
            {
              type: 'paragraph',
              data: { directiveLabel: true },
              children: [{ type: 'text', value: String(node.attrs?.title ?? '') }],
            },
            ...(blocks(content) as Extract<Nodes, { type: 'containerDirective' }>['children']),
          ],
        };
      case 'markdownBlock':
        return { type: 'html', value: String(node.attrs?.source ?? '') };
      default:
        unsupported();
    }
  }
  if (document.type !== 'doc') unsupported();
  return { type: 'root', children: blocks(document.content) };
}

/** Upgrade recognized old p5 fences while retaining the surrounding Markdown verbatim. */
function migrateP5Fences(source: string, options: RichDocumentOptions): string {
  if (!/p5[ \t]/.test(source)) return source;
  const edits: { start: number; end: number; value: string }[] = [];
  function visit(node: Nodes) {
    if (node.type === 'containerDirective' && (options.wya === false || node.name !== 'section'))
      return;
    const sketch = node.type === 'code' ? parseP5Node(node) : null;
    if (
      sketch &&
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
    ) {
      edits.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
        value: stringifyPageTree({ type: 'root', children: [p5MarkdownNode(sketch)] }).trimEnd(),
      });
    } else if ('children' in node) node.children.forEach(visit);
  }
  visit(markdownParser.parse(source));
  for (const edit of edits.reverse())
    source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}

/** Preserve untouched Markdown while applying the editor's supported legacy migrations. */
export function richDocumentToMarkdown(
  document: JSONContent,
  originalSource?: string,
  options: RichDocumentOptions = {},
): string {
  const tree = richTree(document, options);
  if (originalSource !== undefined) {
    try {
      if (options.wya !== false && options.sectionsAsHeadings)
        originalSource = flattenMarkdownSections(originalSource, options);
      const original = richTree(markdownToRichDocument(originalSource, options), options);
      if (JSON.stringify(tree) === JSON.stringify(original))
        return migrateP5Fences(originalSource, options);
    } catch {
      // Invalid Code-view drafts can be replaced by a valid editing document.
    }
  }
  return stringifyPageTree(tree);
}
