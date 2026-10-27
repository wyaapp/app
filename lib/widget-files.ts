import type { Nodes } from 'mdast';
import { AppError } from './app-error.ts';
import { parseFileDocument } from './file-documents.ts';
import { pageDirectiveItem, parsePageSource } from './page-documents.ts';
import { parseGifDirective, type GifEmbed } from './gif.ts';
import { parseP5Node, type P5Embed } from './p5.ts';
import type { LinkItem } from './profile-types.ts';

export type WidgetKind = 'discord' | 'gif' | 'p5' | 'code';
export type WidgetBlock =
  | { kind: 'discord'; item: LinkItem }
  | { kind: 'gif'; gif: GifEmbed }
  | { kind: 'p5'; sketch: P5Embed }
  | { kind: 'code'; language: string; code: string };

function requireClosedFence(source: string, node: Extract<Nodes, { type: 'code' }>) {
  const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
  const lines = raw.split(/\r?\n/);
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0])?.[1];
  if (
    !fence ||
    lines.length < 2 ||
    !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(lines.at(-1)!)
  )
    throw new AppError('Close the code block with its matching code fence.');
}

/** Reuse the document vocabulary, with exactly one supported top-level block. */
export function parseWidgetSource(
  source: string,
  { allowEmpty = true }: { allowEmpty?: boolean } = {},
): WidgetBlock | null {
  const { tree } = parsePageSource(source, { preserveUnknown: true });
  if (tree.children.length === 0 && allowEmpty) return null;
  if (tree.children.length !== 1)
    throw new AppError('A widget needs exactly one block. Use a .md file for multiple blocks.');
  const node = tree.children[0];
  if (node.type === 'code') requireClosedFence(source, node);
  // Reserved embed syntax must validate as that embed, never silently become inert code.
  if (
    (node.type === 'code' && node.lang === 'p5') ||
    (node.type === 'leafDirective' && node.name === 'p5')
  ) {
    const sketch = parseP5Node(node);
    if (!sketch) throw new AppError('Use a public p5.js editor link.');
    return { kind: 'p5', sketch };
  }
  const gif = parseGifDirective(node);
  if (gif) return { kind: 'gif', gif };
  const item = pageDirectiveItem(node);
  if (item?.kind === 'discord') {
    const checked = parseFileDocument(source).data.links[0];
    return { kind: 'discord', item: checked };
  }
  if (node.type === 'code' && !['wya-item', 'gif', 'discord'].includes(node.lang ?? ''))
    return { kind: 'code', language: node.lang ?? '', code: node.value };
  throw new AppError('Widgets support one Discord, GIF, p5.js, or code block.');
}
