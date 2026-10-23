import type { JSONContent } from '@tiptap/core';
import type { Nodes, PhrasingContent, Root, RootContent } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { AppError } from './app-error.ts';
import {
  pageDirectiveItem,
  pageDirectiveSection,
  parsePageTree,
  serializePageItem,
  stringifyPageTree,
} from './page-documents.ts';
import type { LinkItem } from './profile-types.ts';

export type RichDocumentOptions = { wya?: boolean };

const markdownParser = unified().use(remarkParse);
const marksOrder = ['link', 'bold', 'italic', 'code'];

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
  const tree = options.wya === false ? markdownParser.parse(source) : parsePageTree(source);

  function inline(
    nodes: readonly Nodes[],
    marks: NonNullable<JSONContent['marks']> = [],
  ): JSONContent[] {
    return nodes.flatMap((node): JSONContent[] => {
      switch (node.type) {
        case 'text':
          return text(node.value, marks);
        case 'strong':
          return inline(node.children, [...marks, { type: 'bold' }]);
        case 'emphasis':
          return inline(node.children, [...marks, { type: 'italic' }]);
        case 'inlineCode':
          return text(node.value, [...marks, { type: 'code' }]);
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
      case 'paragraph':
        return { type: 'paragraph', content: inline(node.children) };
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
  if (left.type === 'strong' || left.type === 'emphasis') return true;
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
  function inline(nodes: JSONContent[] = []): PhrasingContent[] {
    return mergeInline(
      nodes.map((node): PhrasingContent => {
        let value: PhrasingContent;
        const marks = [...(node.marks ?? [])];
        if (marks.some((mark) => !marksOrder.includes(mark.type))) unsupported();
        switch (node.type) {
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
          if (mark.type === 'bold') value = { type: 'strong', children: [value] };
          else if (mark.type === 'italic') value = { type: 'emphasis', children: [value] };
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
          children: content.map(block) as Extract<Nodes, { type: 'blockquote' }>['children'],
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
            ...(content.map(block) as Extract<Nodes, { type: 'containerDirective' }>['children']),
          ],
        };
      case 'markdownBlock':
        return { type: 'html', value: String(node.attrs?.source ?? '') };
      default:
        unsupported();
    }
  }
  if (document.type !== 'doc') unsupported();
  return { type: 'root', children: (document.content ?? []).map(block) };
}

/**
 * Only Markdown is persisted. Returning the original text for an untouched document avoids
 * dirtying a page just by switching views; edits retain opaque source and every Wya field.
 */
export function richDocumentToMarkdown(
  document: JSONContent,
  originalSource?: string,
  options: RichDocumentOptions = {},
): string {
  const tree = richTree(document, options);
  if (originalSource !== undefined) {
    try {
      const original = richTree(markdownToRichDocument(originalSource, options), options);
      if (JSON.stringify(tree) === JSON.stringify(original)) return originalSource;
    } catch {
      // Invalid Code-view drafts can be replaced by a valid editing document.
    }
  }
  return stringifyPageTree(tree);
}
