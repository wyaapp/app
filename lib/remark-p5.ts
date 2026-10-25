import type { Nodes, Root } from 'mdast';
import { normalizeP5Embed, parseP5Node, type P5Embed } from './p5.ts';

export function remarkP5Embeds() {
  return (tree: Root) => {
    function visit(node: Nodes): Nodes {
      const embed = parseP5Node(node);
      if (embed)
        return {
          type: 'paragraph',
          children: [],
          position: node.position,
          data: {
            hName: 'div',
            hProperties: { 'data-p5-embed': JSON.stringify(embed) },
          },
        };
      if ('children' in node) node.children = node.children.map(visit) as typeof node.children;
      return node;
    }
    visit(tree);
  };
}

export function p5FromMarker(properties: Record<string, unknown> | undefined): P5Embed | null {
  const marker = properties?.['data-p5-embed'];
  if (typeof marker !== 'string' || marker.length > 256 * 1024) return null;
  try {
    return normalizeP5Embed(JSON.parse(marker));
  } catch {
    return null;
  }
}
