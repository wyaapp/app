export type GiphyImage = {
  src: string;
  width: number;
  height: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dimension(value: unknown): number | null {
  if (typeof value === 'string') {
    if (!/^[1-9][0-9]{0,3}$/.test(value)) return null;
    value = Number(value);
  }
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 4096
    ? value
    : null;
}

function imageUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    /[\u0000-\u0020\u007f\\]/.test(value) ||
    !/^https:\/\/(?:media[0-9]*|i)\.giphy\.com\//i.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !/\.(?:gif|webp)$/i.test(url.pathname) ||
      /(?:_s|[-_]still)\.(?:gif|webp)$/i.test(url.pathname)
    )
      return null;
    // Keep GIPHY's exact URL, including its fingerprint and query parameters.
    return value;
  } catch {
    return null;
  }
}

/** Read an animated rendition from a fresh SDK GIF object without storing its URL. */
export function giphyImageFromResult(value: unknown, expectedId: string): GiphyImage | null {
  const gif = record(value);
  if (!/^[a-zA-Z0-9]{1,64}$/.test(expectedId) || gif?.id !== expectedId) return null;
  const original = record(record(gif.images)?.original);
  if (!original) return null;
  const width = dimension(original.width);
  const height = dimension(original.height);
  const src = imageUrl(original.webp) ?? imageUrl(original.url);
  return src && width !== null && height !== null ? { src, width, height } : null;
}
