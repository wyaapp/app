// The bundled Geist font covers Latin, Vietnamese and Cyrillic initials. Keep
// unsupported scripts and emoji out of ImageResponse: its automatic fallback
// would otherwise download fonts or emoji from third parties at request time.
const glyphRanges = [
  [48, 57],
  [65, 90],
  [97, 122],
  [192, 214],
  [216, 246],
  [248, 275],
  [278, 299],
  [302, 311],
  [313, 318],
  [321, 328],
  [330, 333],
  [336, 382],
  [399, 399],
  [402, 402],
  [416, 417],
  [431, 432],
  [461, 462],
  [484, 489],
  [536, 539],
  [567, 567],
  [601, 601],
  [768, 772],
  [774, 780],
  [786, 786],
  [795, 795],
  [803, 803],
  [806, 808],
  [821, 824],
  [923, 923],
  [937, 937],
  [955, 956],
  [960, 960],
  [969, 969],
  [1024, 1119],
  [1122, 1123],
  [1130, 1131],
  [1138, 1141],
  [1168, 1171],
  [1174, 1175],
  [1178, 1179],
  [1186, 1187],
  [1198, 1203],
  [1206, 1207],
  [1210, 1211],
  [1216, 1216],
  [1231, 1231],
  [1240, 1241],
  [1250, 1251],
  [1256, 1257],
  [1262, 1263],
  [7712, 7713],
  [7808, 7813],
  [7838, 7838],
  [7840, 7929],
  [42891, 42892],
] as const;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
// Reuse completed, immutable PNG bytes across profiles with the same initials.
// Never retain response streams or in-flight request promises between Workers
// requests. The small LRU remains bounded even with many distinct initials.
const renderedAvatars = new Map<string, ArrayBuffer>();
const renderedAvatarLimit = 128;

function firstGrapheme(value: string) {
  return graphemes.segment(value)[Symbol.iterator]().next().value?.segment ?? '';
}

function renderedInitials(name: string, handle: string) {
  const initials = name
    .slice(0, 300)
    .normalize('NFC')
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => firstGrapheme(firstGrapheme(part).toUpperCase()))
    .join('');
  if (
    initials &&
    initials.length <= 8 &&
    [...initials].every((character) => {
      const point = character.codePointAt(0)!;
      return glyphRanges.some(([from, to]) => point >= from && point <= to);
    })
  )
    return initials;

  // Handles are ASCII. This also gives symbol-only or unsupported display names
  // a useful identity without rendering missing glyphs or making network calls.
  return (
    handle
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

/** Includes a rendering version so visual changes invalidate avatar ETags. */
export function initialsKey(name: string, handle: string) {
  return `initials-v1:${renderedInitials(name, handle)}`;
}

function pngResponse(bytes: ArrayBuffer) {
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.byteLength),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Load the PNG renderer only for a cache miss on a profile without a picture. */
export async function renderInitialsAvatar(name: string, handle: string): Promise<Response> {
  const key = initialsKey(name, handle);
  const cached = renderedAvatars.get(key);
  if (cached) {
    renderedAvatars.delete(key);
    renderedAvatars.set(key, cached);
    return pngResponse(cached);
  }
  const [{ ImageResponse }, { createElement }] = await Promise.all([
    import('next/og'),
    import('react'),
  ]);
  const response = new ImageResponse(
    createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#fffdf4',
          color: '#1d1d1b',
          fontSize: 104,
          fontWeight: 400,
          letterSpacing: -3,
        },
      },
      renderedInitials(name, handle),
    ),
    { width: 256, height: 256 },
  );
  // Finish rendering here so failures reject normally instead of surfacing
  // after the caller has started streaming or caching a successful response.
  const bytes = await response.arrayBuffer();
  renderedAvatars.set(key, bytes);
  if (renderedAvatars.size > renderedAvatarLimit)
    renderedAvatars.delete(renderedAvatars.keys().next().value!);
  return pngResponse(bytes);
}
