import type { Nodes, RootContent } from 'mdast';
import { AppError } from './app-error.ts';
import { GIF_DEFAULT_WIDTH, GIF_MAX_WIDTH, GIF_MIN_WIDTH } from './gif.ts';

export type ImageEmbed = {
  src: string;
  alt?: string;
  title?: string;
  size?: number | 'full';
};

const attributes = new Set(['src', 'title', 'size']);

function safeImageUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f\\]/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

/** Only image URLs and presentation data are persisted; never HTML or executable attributes. */
export function normalizeImageEmbed(value: unknown): ImageEmbed | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const image = value as Record<string, unknown>;
  if (!safeImageUrl(image.src)) return null;
  for (const key of ['alt', 'title']) {
    const label = image[key];
    if (
      label != null &&
      (typeof label !== 'string' || label.length > 1000 || /[\u0000-\u001f\u007f]/.test(label))
    )
      return null;
  }
  if (
    image.size != null &&
    image.size !== 'full' &&
    (typeof image.size !== 'number' ||
      !Number.isInteger(image.size) ||
      image.size < GIF_MIN_WIDTH ||
      image.size > GIF_MAX_WIDTH)
  )
    return null;
  return {
    src: image.src,
    ...(image.alt ? { alt: image.alt as string } : {}),
    ...(image.title ? { title: image.title as string } : {}),
    ...(image.size != null ? { size: image.size as number | 'full' } : {}),
  };
}

/** A cheap paste-time hint. Loading the image confirms availability without metadata requests. */
export function parseImageUrl(input: string): ImageEmbed | null {
  const image = normalizeImageEmbed({ src: input.trim() });
  if (!image) return null;
  return /\.(?:gif|png|jpe?g|webp|avif|apng|bmp)$/i.test(new URL(image.src).pathname)
    ? image
    : null;
}

export function imageDisplayMaxWidth(image: Pick<ImageEmbed, 'size'>): number | 'none' {
  return image.size === 'full' ? 'none' : (image.size ?? GIF_DEFAULT_WIDTH);
}

export function parseImageDirective(node: Nodes): ImageEmbed | null {
  if (node.type !== 'leafDirective' || node.name !== 'image') return null;
  const values = node.attributes ?? {};
  if (
    Object.keys(values).some((key) => !attributes.has(key)) ||
    node.children.some((child) => child.type !== 'text')
  )
    return null;
  let size: ImageEmbed['size'];
  if (values.size !== undefined) {
    if (values.size === 'full') size = 'full';
    else if (/^[1-9][0-9]{0,3}$/.test(values.size ?? '')) size = Number(values.size);
    else return null;
  }
  return normalizeImageEmbed({
    src: values.src,
    alt: node.children.map((child) => (child.type === 'text' ? child.value : '')).join(''),
    title: values.title,
    size,
  });
}

/** Default images use portable Markdown. Only a custom display size needs a directive. */
export function imageMarkdownNode(image: ImageEmbed): RootContent {
  const value = normalizeImageEmbed(image);
  if (!value) throw new AppError('Use a valid HTTPS image URL.');
  if (value.size === undefined)
    return {
      type: 'paragraph',
      children: [
        { type: 'image', url: value.src, alt: value.alt ?? '', title: value.title ?? null },
      ],
    };
  return {
    type: 'leafDirective',
    name: 'image',
    attributes: {
      src: value.src,
      size: String(value.size),
      ...(value.title ? { title: value.title } : {}),
    },
    children: value.alt ? [{ type: 'text', value: value.alt }] : [],
  };
}
