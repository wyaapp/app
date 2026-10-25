import type { Nodes, Root } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { normalizeGifEmbed, parseGifDirective, type GifEmbed } from './gif.ts';
import { restoreMarkdownText } from './page-documents.ts';
import { remarkStrikethrough } from './remark-strikethrough.ts';
import { parseFontDirective } from './remark-fonts.ts';
import { parseImageDirective } from './image.ts';
import { parseP5Node } from './p5.ts';
import { parseBadgeDirective } from './badge.ts';

const plainMarkdown = unified().use(remarkParse).use(remarkStrikethrough);

function preserveUnknownDirectives(tree: Root, source: string, wya: boolean) {
  function visit(node: Nodes) {
    if (!('children' in node)) return;
    node.children = node.children.flatMap((child): Nodes[] => {
      const raw = () => source.slice(child.position?.start.offset, child.position?.end.offset);
      if (
        child.type === 'textDirective' &&
        !parseFontDirective(child) &&
        !parseBadgeDirective(child)
      )
        return [{ type: 'text', value: raw(), position: child.position }];
      if (
        (child.type === 'leafDirective' || child.type === 'containerDirective') &&
        !(wya && ['link', 'item', 'section'].includes(child.name)) &&
        !parseGifDirective(child) &&
        !parseImageDirective(child) &&
        !parseP5Node(child)
      )
        // In a plain file these are ordinary Markdown, not executable custom blocks.
        // Reparse the whole unknown container so nested directives stay literal too.
        return plainMarkdown.parse(raw()).children;
      visit(child);
      return [child];
    }) as typeof node.children;
  }
  visit(tree);
}

/** Convert only validated block directives into a marker consumed by React. */
export function remarkGifEmbeds(options: { preserveUnknown?: boolean; wya?: boolean } = {}) {
  return (tree: Root, file: { toString(): string }) => {
    const source = String(file);
    restoreMarkdownText(tree, source);
    if (options.preserveUnknown) preserveUnknownDirectives(tree, source, !!options.wya);
    function visit(node: Nodes) {
      const gif = parseGifDirective(node);
      if (gif) {
        node.data = {
          ...node.data,
          hName: 'div',
          hProperties: { 'data-wya-gif': JSON.stringify(gif) },
        };
        if ('children' in node) node.children = [];
        return;
      }
      if ('children' in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}

export function gifFromMarker(properties: Record<string, unknown> | undefined): GifEmbed | null {
  const marker = properties?.['data-wya-gif'];
  if (typeof marker !== 'string') return null;
  try {
    return normalizeGifEmbed(JSON.parse(marker));
  } catch {
    return null;
  }
}
