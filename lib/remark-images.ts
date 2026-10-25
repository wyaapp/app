import type { Nodes, Root } from 'mdast';
import { normalizeImageEmbed, parseImageDirective, type ImageEmbed } from './image.ts';

/** Give standalone Markdown images and resized image directives the same public renderer. */
export function remarkImageEmbeds() {
  return (tree: Root) => {
    function visit(node: Nodes) {
      let image = parseImageDirective(node);
      if (node.type === 'paragraph' && node.children.length === 1) {
        const child = node.children[0];
        if (child.type === 'image')
          image = normalizeImageEmbed({ src: child.url, alt: child.alt, title: child.title });
      }
      if (image) {
        node.data = {
          ...node.data,
          hName: 'div',
          hProperties: { 'data-wya-image': JSON.stringify(image) },
        };
        if ('children' in node) node.children = [];
        return;
      }
      if ('children' in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}

export function imageFromMarker(
  properties: Record<string, unknown> | undefined,
): ImageEmbed | null {
  const marker = properties?.['data-wya-image'];
  if (typeof marker !== 'string') return null;
  try {
    return normalizeImageEmbed(JSON.parse(marker));
  } catch {
    return null;
  }
}
