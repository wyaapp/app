import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import {
  GIF_DEFAULT_WIDTH,
  GIF_MAX_WIDTH,
  GIF_MIN_WIDTH,
  gifDirectiveNode,
  gifDisplayMaxWidth,
  gifEmbedUrl,
  gifSourceUrl,
  normalizeGifEmbed,
  parseGifDirective,
  parseGifUrl,
  type GifEmbed,
} from '../lib/gif.ts';
import { stringifyPageTree } from '../lib/page-documents.ts';

const parser = unified().use(remarkParse).use(remarkDirective);

test('official GIPHY page, embed and media links resolve to a stable ID without retaining tracking', () => {
  const id = 'YsTs5ltWtEhnq';
  for (const url of [
    `https://giphy.com/gifs/${id}`,
    `https://www.giphy.com/gifs/happy-cat-${id}?utm_source=share`,
    `https://giphy.com/embed/${id}/`,
    `https://media.giphy.com/media/${id}/giphy.gif`,
    `https://media2.giphy.com/media/${id}/200w.webp?cid=test`,
    `https://media1.giphy.com/media/v1_abc123/${id}/giphy.mp4`,
  ]) {
    assert.deepEqual(parseGifUrl(url), { provider: 'giphy', id }, url);
  }
});

test('Tenor page and embed links retain full numeric IDs without floating point conversion', () => {
  const id = '1174838705394808298';
  for (const url of [
    `https://tenor.com/view/good-morning-gif-${id}`,
    `https://www.tenor.com/view/gif-${id}?utm_source=share`,
    `https://tenor.com/pt-BR/view/good-morning-gif-${id}`,
    `https://tenor.com/view/${id}`,
    `https://tenor.com/embed/${id}`,
  ]) {
    assert.deepEqual(parseGifUrl(url), { provider: 'tenor', id }, url);
  }
});

test('untrusted hosts, malformed paths, unsafe schemes and nonrecoverable URLs are rejected', () => {
  for (const url of [
    'http://giphy.com/gifs/YsTs5ltWtEhnq',
    'javascript:alert(1)',
    'data:text/html,test',
    '//giphy.com/gifs/YsTs5ltWtEhnq',
    'https://giphy.com.evil.example/gifs/YsTs5ltWtEhnq',
    'https://evil.example/?https://giphy.com/gifs/YsTs5ltWtEhnq',
    'https://user:password@giphy.com/gifs/YsTs5ltWtEhnq',
    'https://giphy.com:8080/gifs/YsTs5ltWtEhnq',
    'https://giphy.com./gifs/YsTs5ltWtEhnq',
    'https://giphy.com/gifs/id/more',
    'https://giphy.com/gifs/id%2fother',
    'https://giphy.com/gifs/id\\other',
    'https://giphy.com/gifs/',
    'https://giphy.com/channel/name',
    'https://tenor.com/embed/0',
    'https://tenor.com/embed/123abc',
    'https://tenor.com/view/cat-gif-12/other',
    'https://tenor.com/bVvd1.gif',
    'https://media.tenor.com/abc123/hello.gif',
    'https://media0.giphy.com/avatars/user/file.gif',
    'https://media0.giphy.com/media/abc123/file.svg',
  ])
    assert.equal(parseGifUrl(url), null, url);
});

test('GIF payloads validate identity, titles and bounded optional dimensions', () => {
  const gif: GifEmbed = {
    provider: 'tenor',
    id: '1174838705394808298',
    title: 'Hello!',
    width: 480,
    height: 270,
  };
  assert.deepEqual(normalizeGifEmbed(gif), gif);
  assert.deepEqual(normalizeGifEmbed({ provider: 'giphy', id: 'abc', unexpected: 'discard' }), {
    provider: 'giphy',
    id: 'abc',
  });
  for (const invalid of [
    null,
    { ...gif, provider: 'youtube' },
    { ...gif, id: 1174838705394808298 },
    { ...gif, id: '12/other' },
    { ...gif, id: '0' },
    { ...gif, title: '<script>\0' },
    { ...gif, title: 'a'.repeat(301) },
    { ...gif, width: 0 },
    { ...gif, width: 480.5 },
    { ...gif, height: 4097 },
    { ...gif, height: '270' },
  ])
    assert.equal(normalizeGifEmbed(invalid), null);
});

test('display sizes preserve intrinsic dimensions and keep the existing default implicit', () => {
  const gif: GifEmbed = { provider: 'giphy', id: 'cat', width: 480, height: 270 };
  assert.deepEqual(normalizeGifEmbed(gif), gif);
  assert.equal(gifDisplayMaxWidth(gif), GIF_DEFAULT_WIDTH);
  assert.equal(gifDirectiveNode(gif).attributes?.size, undefined);
  for (const size of [GIF_MIN_WIDTH, GIF_DEFAULT_WIDTH, 640, GIF_MAX_WIDTH, 'full'] as const) {
    const sizedGif: GifEmbed = { ...gif, size };
    assert.deepEqual(normalizeGifEmbed(sizedGif), sizedGif);
    assert.equal(gifDisplayMaxWidth(sizedGif), size === 'full' ? 'none' : size);
    const source = stringifyPageTree({ type: 'root', children: [gifDirectiveNode(sizedGif)] });
    assert.deepEqual(parseGifDirective(parser.parse(source).children[0]), sizedGif);
  }
});

test('invalid display sizes are rejected instead of changing the GIF dimensions or default', () => {
  const gif: GifEmbed = { provider: 'giphy', id: 'cat', width: 480, height: 270 };
  for (const size of [
    null,
    0,
    GIF_MIN_WIDTH - 1,
    GIF_MAX_WIDTH + 1,
    384.5,
    NaN,
    Infinity,
    '384',
    'auto',
    '100%',
    true,
    {},
  ]) {
    assert.equal(normalizeGifEmbed({ ...gif, size }), null, String(size));
    assert.throws(() => gifDirectiveNode({ ...gif, size } as GifEmbed), /valid GIPHY or Tenor/);
  }
  for (const size of [
    '',
    '119',
    '1921',
    '384.5',
    '-384',
    '0384',
    '384px',
    '100%',
    'auto',
    'FULL',
  ]) {
    const source = `::gif{provider="giphy" id="cat" size="${size}"}`;
    assert.equal(parseGifDirective(parser.parse(source).children[0]), null, source);
  }
});

test('embed and source URLs are fixed provider destinations and never caller supplied URLs', () => {
  const giphy: GifEmbed = { provider: 'giphy', id: 'YsTs5ltWtEhnq' };
  const tenor: GifEmbed = { provider: 'tenor', id: '18120762' };
  assert.equal(gifEmbedUrl(giphy), 'https://giphy.com/embed/YsTs5ltWtEhnq');
  assert.equal(gifSourceUrl(giphy), 'https://giphy.com/gifs/YsTs5ltWtEhnq');
  assert.equal(gifEmbedUrl(tenor), 'https://tenor.com/embed/18120762');
  assert.equal(gifSourceUrl(tenor), 'https://tenor.com/view/gif-18120762');
  assert.throws(() => gifEmbedUrl({ ...giphy, id: '../evil' }), /valid GIPHY or Tenor/);
  assert.throws(() => gifSourceUrl({ ...tenor, provider: 'evil' } as unknown as GifEmbed));
});

test('GIF directives escape labels and round trip without embedding media URLs or HTML', () => {
  const gif: GifEmbed = {
    provider: 'giphy',
    id: 'YsTs5ltWtEhnq',
    title: 'A **happy** [cat] & <friend> :wave: ~hello~',
    width: 480,
    height: 270,
  };
  const source = stringifyPageTree({ type: 'root', children: [gifDirectiveNode(gif)] });
  assert.deepEqual(parseGifDirective(parser.parse(source).children[0]), gif);
  assert.ok(!source.includes('https://') && !source.includes('<friend>'));
  for (const source of [
    '::gif{provider="evil" id="abc"}',
    '::gif{provider="giphy" id="a/b"}',
    '::gif{provider="tenor" id="1" src="https://evil.example"}',
    '::gif{provider="tenor" id="1" width="480px"}',
    '::gif{provider="tenor" id="1" height="-1"}',
    '::gif{provider="tenor" id="1" width="4097"}',
    '::gif[**Rich title**]{provider="tenor" id="1"}',
    '::other{provider="giphy" id="abc"}',
  ])
    assert.equal(parseGifDirective(parser.parse(source).children[0]), null, source);
});
