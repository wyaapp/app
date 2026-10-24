import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giphyImageFromResult } from '../lib/giphy-media.ts';

const id = '6hKL8BI8rRNrMRFtAx';
const webp = `https://media2.giphy.com/media/v1.Y2lkPXRlc3Q/${id}/giphy.webp?cid=abc&ep=v1_gifs_gifId&rid=giphy.webp&ct=g`;
const gifUrl = `https://media.giphy.com/media/${id}/giphy.gif?cid=abc&rid=giphy.gif`;
const result = {
  id,
  type: 'gif',
  images: { original: { width: '360', height: '272', webp, url: gifUrl } },
};

test('selects the animated original WebP and retains the exact provider URL', () => {
  assert.deepEqual(giphyImageFromResult(result, id), { src: webp, width: 360, height: 272 });
});

test('falls back to the original GIF when WebP is absent or invalid', () => {
  for (const unavailableWebp of [undefined, '', 'https://example.com/cat.webp']) {
    assert.deepEqual(
      giphyImageFromResult(
        {
          ...result,
          images: { original: { ...result.images.original, webp: unavailableWebp } },
        },
        id,
      ),
      { src: gifUrl, width: 360, height: 272 },
    );
  }
});

test('accepts numeric dimensions and all documented GIPHY image hosts', () => {
  for (const host of ['media.giphy.com', 'media0.giphy.com', 'media12.giphy.com', 'i.giphy.com']) {
    const src = `https://${host}/media/${id}/giphy.gif?rid=giphy.gif&ct=g`;
    assert.deepEqual(
      giphyImageFromResult({ id, images: { original: { width: 4096, height: 1, url: src } } }, id),
      { src, width: 4096, height: 1 },
    );
  }
});

test('rejects malformed objects, missing renditions and mismatched GIF identity', () => {
  for (const invalid of [
    null,
    undefined,
    [],
    'gif',
    {},
    { ...result, id: 'anotherGif' },
    { ...result, id: 123 },
    { id, images: null },
    { id, images: [] },
    { id, images: { original: [] } },
    { id, images: { original_still: result.images.original } },
    { data: result },
  ]) {
    assert.equal(giphyImageFromResult(invalid, id), null);
  }
  assert.equal(giphyImageFromResult({ ...result, id: '' }, ''), null);
  assert.equal(giphyImageFromResult({ ...result, id: '../gif' }, '../gif'), null);
});

test('rejects unsafe hosts, schemes, credentials, ports and nonanimated renditions', () => {
  for (const src of [
    `http://media.giphy.com/media/${id}/giphy.gif`,
    `//media.giphy.com/media/${id}/giphy.gif`,
    'javascript:alert(1)',
    'data:image/gif;base64,AAAA',
    `https://giphy.com/media/${id}/giphy.gif`,
    `https://media.giphy.com.example.com/media/${id}/giphy.gif`,
    `https://other.giphy.com/media/${id}/giphy.gif`,
    `https://media.giphy.com./media/${id}/giphy.gif`,
    `https://user:password@media.giphy.com/media/${id}/giphy.gif`,
    `https://media.giphy.com:443/media/${id}/giphy.gif`,
    `https://media.giphy.com:8443/media/${id}/giphy.gif`,
    `https://media.giphy.com/media/${id}/giphy.mp4`,
    `https://media.giphy.com/media/${id}/giphy.png`,
    `https://media.giphy.com/media/${id}/giphy.svg`,
    `https://media.giphy.com/media/${id}/giphy_s.gif`,
    `https://media.giphy.com/media/${id}/giphy-still.webp`,
    `https://media.giphy.com/media/${id}/giphy.webp/more`,
    `https://media.giphy.com/media/${id}/giphy%2egif`,
    ` https://media.giphy.com/media/${id}/giphy.gif`,
    `https://media.giphy.com/media/${id}/giphy.gif\n`,
    `https://media.giphy.com\\@example.com/media/${id}/giphy.gif`,
  ]) {
    assert.equal(
      giphyImageFromResult({ id, images: { original: { width: 360, height: 272, url: src } } }, id),
      null,
      src,
    );
  }
});

test('requires bounded positive integral dimensions without coercing arbitrary values', () => {
  for (const invalid of [
    undefined,
    null,
    true,
    0,
    -1,
    1.5,
    4097,
    NaN,
    Infinity,
    '',
    '0',
    '1.5',
    '480px',
    '1e2',
    ' 360',
    '4097',
  ]) {
    for (const key of ['width', 'height']) {
      assert.equal(
        giphyImageFromResult(
          { ...result, images: { original: { ...result.images.original, [key]: invalid } } },
          id,
        ),
        null,
        `${key}: ${String(invalid)}`,
      );
    }
  }
});
