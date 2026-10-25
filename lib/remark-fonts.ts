import type { Nodes, Root } from 'mdast';
import { profileFonts, type ProfileFont } from './profile-fonts.ts';

/** Font names are registry IDs, never user-supplied CSS or remote font URLs. */
export function inlineFontId(value: unknown): ProfileFont | null {
  return typeof value === 'string' && Object.hasOwn(profileFonts, value)
    ? (value as ProfileFont)
    : null;
}

export function parseFontDirective(node: Nodes): ProfileFont | null {
  if (node.type !== 'textDirective' || node.name !== 'font') return null;
  const attributes = node.attributes ?? {};
  if (Object.keys(attributes).some((key) => key !== 'family')) return null;
  return inlineFontId(attributes.family);
}

export function inlineFontStyle(font: ProfileFont): string {
  const choice = profileFonts[font];
  return `--inline-font-body: ${choice.body}; --inline-font-heading: ${choice.heading}`;
}

/** Render the same whitelisted inline font syntax in file and public-page previews. */
export function remarkFonts() {
  return (tree: Root) => {
    function visit(node: Nodes) {
      const font = parseFontDirective(node);
      if (font)
        node.data = {
          ...node.data,
          hName: 'span',
          hProperties: { 'data-font-family': font, style: inlineFontStyle(font) },
        };
      if ('children' in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}
