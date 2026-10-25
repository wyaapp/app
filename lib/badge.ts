import type { Nodes } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import { AppError } from './app-error.ts';

export type BadgeEmbed = { src: string; alt: string; href?: string };

export const MAX_BADGE_IMAGE_BYTES = 16 * 1024;
const MAX_BADGE_WIDTH = 320;
const MAX_BADGE_HEIGHT = 64;
const attributes = new Set(['src', 'href']);
const markdown = unified().use(remarkParse).use(remarkDirective);

function webUrl(value: unknown, image = false): value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f\\]/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || (!image && url.protocol === 'http:')) &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

/** The badge archive copies tiny raster images as data URLs, not remote image links. */
export function isBadgeDataUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_BADGE_IMAGE_BYTES / 3) * 4 + 32)
    return false;
  const match = /^data:image\/(png|gif);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (
    !match ||
    !match[2] ||
    match[2].length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(match[2])
  )
    return false;
  let bytes: string;
  try {
    bytes = atob(match[2]);
  } catch {
    return false;
  }
  if (bytes.length > MAX_BADGE_IMAGE_BYTES) return false;
  const byte = (index: number) => bytes.charCodeAt(index);
  let width: number;
  let height: number;
  if (match[1] === 'png') {
    if (
      bytes.length < 33 ||
      bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n' ||
      bytes.slice(8, 16) !== '\x00\x00\x00\x0dIHDR'
    )
      return false;
    const uint32 = (offset: number) =>
      byte(offset) * 0x1000000 +
      (byte(offset + 1) << 16) +
      (byte(offset + 2) << 8) +
      byte(offset + 3);
    width = uint32(16);
    height = uint32(20);
  } else {
    if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.slice(0, 6))) return false;
    width = byte(6) + (byte(7) << 8);
    height = byte(8) + (byte(9) << 8);
  }
  return width > 0 && width <= MAX_BADGE_WIDTH && height > 0 && height <= MAX_BADGE_HEIGHT;
}

/** Persist only validated image/link data. HTML, scripts, and SVG data URLs are never accepted. */
export function normalizeBadgeEmbed(value: unknown): BadgeEmbed | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const badge = value as Record<string, unknown>;
  if (!webUrl(badge.src, true) && !isBadgeDataUrl(badge.src)) return null;
  const alt = badge.alt ?? '';
  if (typeof alt !== 'string' || alt.length > 200 || /[\u0000-\u001f\u007f]/.test(alt)) return null;
  if (badge.href != null && badge.href !== '' && !webUrl(badge.href)) return null;
  return {
    src: badge.src as string,
    alt,
    ...(badge.href ? { href: badge.href as string } : {}),
  };
}

/** Cheap automatic detection: other image URLs require an explicit Badge insertion. */
export function parseBadgeUrl(input: string): BadgeEmbed | null {
  const src = input.trim();
  if (isBadgeDataUrl(src)) return { src, alt: 'Badge' };
  if (!webUrl(src, true)) return null;
  const url = new URL(src);
  if (
    (url.hostname === 'img.shields.io' && url.pathname !== '/') ||
    (url.hostname === 'web.badges.world' && /\.(?:png|gif)$/i.test(url.pathname))
  )
    return { src, alt: 'Badge' };
  return null;
}

export function badgeIsPixelArt(src: string): boolean {
  return isBadgeDataUrl(src) || (webUrl(src, true) && new URL(src).hostname === 'web.badges.world');
}

export function parseBadgeDirective(node: Nodes): BadgeEmbed | null {
  if (node.type !== 'textDirective' || node.name !== 'badge') return null;
  const values = node.attributes ?? {};
  if (
    Object.keys(values).some((key) => !attributes.has(key)) ||
    node.children.some((child) => child.type !== 'text')
  )
    return null;
  return normalizeBadgeEmbed({
    src: values.src,
    href: values.href,
    alt: node.children.map((child) => (child.type === 'text' ? child.value : '')).join(''),
  });
}

function markdownImage(node: Nodes): BadgeEmbed | null {
  if (node.type === 'image') return normalizeBadgeEmbed({ src: node.url, alt: node.alt });
  if (node.type === 'link' && node.children.length === 1 && node.children[0].type === 'image') {
    const image = node.children[0];
    return normalizeBadgeEmbed({ src: image.url, alt: image.alt, href: node.url });
  }
  return null;
}

/** Recognize familiar badge Markdown without treating every ordinary image as a badge. */
export function badgeFromMarkdownNode(node: Nodes): BadgeEmbed | null {
  const directive = parseBadgeDirective(node);
  if (directive) return directive;
  const image = markdownImage(node);
  return image && parseBadgeUrl(image.src) ? image : null;
}

/** Explicit picker input accepts a URL, one Markdown image/link, or our badge syntax. */
export function parseBadgeInput(input: string): BadgeEmbed | null {
  const source = input.trim();
  if (!source || source.length > Math.ceil(MAX_BADGE_IMAGE_BYTES / 3) * 4 + 4096) return null;
  const direct = normalizeBadgeEmbed({ src: source, alt: 'Badge' });
  if (direct) return direct;
  const tree = markdown.parse(source);
  if (tree.children.length !== 1 || tree.children[0].type !== 'paragraph') return null;
  const children = tree.children[0].children;
  if (children.length !== 1) return null;
  return parseBadgeDirective(children[0]) ?? markdownImage(children[0]);
}

export function badgeMarkdownNode(badge: BadgeEmbed): Extract<Nodes, { type: 'textDirective' }> {
  const value = normalizeBadgeEmbed(badge);
  if (!value) throw new AppError('Use a valid badge image URL or copied badge image.');
  return {
    type: 'textDirective',
    name: 'badge',
    attributes: { src: value.src, ...(value.href ? { href: value.href } : {}) },
    children: value.alt ? [{ type: 'text', value: value.alt }] : [],
  };
}
