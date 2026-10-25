import type { Nodes } from 'mdast';
import { AppError } from './app-error.ts';

export type GifEmbed = {
  provider: 'giphy' | 'tenor';
  id: string;
  title?: string;
  width?: number;
  height?: number;
  size?: number | 'full';
  sourceUrl?: string;
};

export const GIF_DEFAULT_WIDTH = 384;
export const GIF_MIN_WIDTH = 120;
export const GIF_MAX_WIDTH = 1920;

type GifDirective = Extract<Nodes, { type: 'leafDirective' }>;
const attributes = new Set(['provider', 'id', 'width', 'height', 'size', 'sourceUrl']);

export function gifDisplayMaxWidth(gif: Pick<GifEmbed, 'size'>): number | 'none' {
  return gif.size === 'full' ? 'none' : (gif.size ?? GIF_DEFAULT_WIDTH);
}

/** Persist provider identity, never API media URLs or arbitrary embed HTML. */
export function normalizeGifEmbed(value: unknown): GifEmbed | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const gif = value as Record<string, unknown>;
  if (gif.provider !== 'giphy' && gif.provider !== 'tenor') return null;
  if (
    typeof gif.id !== 'string' ||
    !(gif.provider === 'giphy' ? /^[a-zA-Z0-9]{1,64}$/ : /^[1-9][0-9]{0,24}$/).test(gif.id)
  )
    return null;
  if (
    gif.title !== undefined &&
    (typeof gif.title !== 'string' ||
      gif.title.length > 300 ||
      /[\u0000-\u001f\u007f]/.test(gif.title))
  )
    return null;
  for (const key of ['width', 'height']) {
    const dimension = gif[key];
    if (
      dimension !== undefined &&
      (typeof dimension !== 'number' ||
        !Number.isInteger(dimension) ||
        dimension < 1 ||
        dimension > 4096)
    )
      return null;
  }
  if (
    gif.size !== undefined &&
    gif.size !== 'full' &&
    (typeof gif.size !== 'number' ||
      !Number.isInteger(gif.size) ||
      gif.size < GIF_MIN_WIDTH ||
      gif.size > GIF_MAX_WIDTH)
  )
    return null;
  if (gif.sourceUrl !== undefined) {
    if (typeof gif.sourceUrl !== 'string' || gif.sourceUrl !== gif.sourceUrl.trim()) return null;
    const source = parseGifUrl(gif.sourceUrl);
    if (!source || source.provider !== gif.provider || source.id !== gif.id) return null;
  }
  return {
    provider: gif.provider,
    id: gif.id,
    ...(gif.title ? { title: gif.title as string } : {}),
    ...(gif.width !== undefined ? { width: gif.width as number } : {}),
    ...(gif.height !== undefined ? { height: gif.height as number } : {}),
    ...(gif.size !== undefined ? { size: gif.size as number | 'full' } : {}),
    ...(gif.sourceUrl !== undefined ? { sourceUrl: gif.sourceUrl as string } : {}),
  };
}

/** Extract stable IDs only from official URLs with a known, unambiguous shape. */
export function parseGifUrl(input: string): GifEmbed | null {
  const value = input.trim();
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const path = url.pathname.replace(/\/$/, '');
  if (url.hostname === 'giphy.com' || url.hostname === 'www.giphy.com') {
    const embed = /^\/embed\/([a-zA-Z0-9]+)$/.exec(path);
    const page = /^\/gifs\/([a-zA-Z0-9-]+)$/.exec(path);
    const id = embed?.[1] ?? page?.[1].split('-').at(-1);
    return id ? normalizeGifEmbed({ provider: 'giphy', id }) : null;
  }
  if (/^media[0-9]*\.giphy\.com$/.test(url.hostname)) {
    // Giphy adds an optional tracking token before the ID on some CDN URLs.
    const media =
      /^\/media\/(?:[a-zA-Z0-9_-]+\/)?([a-zA-Z0-9]+)\/[a-zA-Z0-9_-]+\.(?:gif|webp|mp4)$/.exec(path);
    return media ? normalizeGifEmbed({ provider: 'giphy', id: media[1] }) : null;
  }
  if (url.hostname === 'tenor.com' || url.hostname === 'www.tenor.com') {
    const embed = /^\/embed\/([0-9]+)$/.exec(path);
    const page = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?view\/(?:[^/]+-gif-|gif-)?([0-9]+)$/.exec(path);
    const id = embed?.[1] ?? page?.[1];
    return id ? normalizeGifEmbed({ provider: 'tenor', id }) : null;
  }
  // Tenor CDN hashes and shortened share URLs do not encode a recoverable post ID.
  return null;
}

export function parseGifDirective(node: Nodes): GifEmbed | null {
  if (node.type !== 'leafDirective' || node.name !== 'gif') return null;
  const values = node.attributes ?? {};
  if (
    Object.keys(values).some((key) => !attributes.has(key)) ||
    node.children.some((child) => child.type !== 'text')
  )
    return null;
  const dimensions: Partial<Pick<GifEmbed, 'width' | 'height'>> = {};
  for (const key of ['width', 'height'] as const) {
    if (values[key] === undefined) continue;
    if (!/^[1-9][0-9]{0,3}$/.test(values[key] ?? '')) return null;
    dimensions[key] = Number(values[key]);
  }
  let size: GifEmbed['size'];
  if (values.size !== undefined) {
    if (values.size === 'full') size = 'full';
    else if (/^[1-9][0-9]{0,3}$/.test(values.size ?? '')) size = Number(values.size);
    else return null;
  }
  return normalizeGifEmbed({
    provider: values.provider,
    id: values.id,
    title: node.children.map((child) => (child.type === 'text' ? child.value : '')).join(''),
    ...dimensions,
    ...(size !== undefined ? { size } : {}),
    ...(values.sourceUrl !== undefined ? { sourceUrl: values.sourceUrl } : {}),
  });
}

function checkedGif(gif: GifEmbed): GifEmbed {
  const normalized = normalizeGifEmbed(gif);
  if (!normalized) throw new AppError('Use a valid GIPHY or Tenor GIF.');
  return normalized;
}

export function gifDirectiveNode(gif: GifEmbed): GifDirective {
  const value = checkedGif(gif);
  return {
    type: 'leafDirective',
    name: 'gif',
    attributes: {
      provider: value.provider,
      id: value.id,
      ...(value.width !== undefined ? { width: String(value.width) } : {}),
      ...(value.height !== undefined ? { height: String(value.height) } : {}),
      ...(value.size !== undefined ? { size: String(value.size) } : {}),
      ...(value.sourceUrl !== undefined ? { sourceUrl: value.sourceUrl } : {}),
    },
    children: value.title ? [{ type: 'text', value: value.title }] : [],
  };
}

export function gifEmbedUrl(gif: GifEmbed): string {
  const value = checkedGif(gif);
  return `https://${value.provider === 'giphy' ? 'giphy' : 'tenor'}.com/embed/${value.id}`;
}

export function gifSourceUrl(gif: GifEmbed): string {
  const value = checkedGif(gif);
  if (value.sourceUrl) return value.sourceUrl;
  return value.provider === 'giphy'
    ? `https://giphy.com/gifs/${value.id}`
    : `https://tenor.com/view/gif-${value.id}`;
}
