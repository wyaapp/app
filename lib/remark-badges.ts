import type { Nodes, Root } from 'mdast';
import {
  badgeFromMarkdownNode,
  badgeMarkdownNode,
  normalizeBadgeEmbed,
  type BadgeEmbed,
} from './badge.ts';

/** Inline markers keep badges at their natural size and never evaluate embed HTML. */
export function remarkBadgeEmbeds() {
  return (tree: Root) => {
    function visit(node: Nodes): Nodes {
      const badge = badgeFromMarkdownNode(node);
      if (badge)
        return {
          ...badgeMarkdownNode(badge),
          position: node.position,
          data: {
            ...node.data,
            hName: 'span',
            hProperties: { 'data-wya-badge': JSON.stringify(badge) },
          },
          children: [],
        };
      if ('children' in node) node.children = node.children.map(visit) as typeof node.children;
      return node;
    }
    visit(tree);
  };
}

export function badgeFromMarker(
  properties: Record<string, unknown> | undefined,
): BadgeEmbed | null {
  const marker = properties?.['data-wya-badge'];
  if (typeof marker !== 'string' || marker.length > 32 * 1024) return null;
  try {
    return normalizeBadgeEmbed(JSON.parse(marker));
  } catch {
    return null;
  }
}
