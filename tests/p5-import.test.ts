import test from 'node:test';
import assert from 'node:assert/strict';
import { createP5ImportClient, p5FromEditorProject } from '../lib/p5-import-server.ts';
import { importP5Sketch, readP5Response } from '../lib/p5-import.ts';

const url = 'https://editor.p5js.org/p5/sketches/4GluUaiHzPj';
const project = {
  name: 'Hosted drawing',
  visibility: 'Public',
  files: [
    { name: 'index.html', content: '<script src="extra-library.js"></script>' },
    { name: 'sketch.js', content: 'function setup() {}' },
    { name: 'extra-library.js', content: '/* Hosted by p5 */' },
    { name: 'photo.png', url: 'https://assets.editor.p5js.org/photo.png' },
  ],
};
const embed = { url, title: 'Hosted drawing' };

test('title lookup accepts hosted files, assets and libraries without returning source', () => {
  assert.deepEqual(p5FromEditorProject(project, url), embed);
  assert.deepEqual(p5FromEditorProject({ name: 'No files needed' }, url), {
    url,
    title: 'No files needed',
  });
  assert.throws(() => p5FromEditorProject({ ...project, visibility: 'Private' }, url), /private/);
  assert.throws(() => p5FromEditorProject(null, url), /invalid/);
});

test('metadata lookup uses only the fixed official endpoint and caches briefly', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let clock = 0;
  const client = createP5ImportClient({
    now: () => clock,
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json(project);
    },
  });
  assert.deepEqual(await client.get('https://preview.p5js.org/p5/embed/4GluUaiHzPj'), embed);
  assert.deepEqual(await client.get(url), embed);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://editor.p5js.org/editor/p5/projects/4GluUaiHzPj');
  assert.equal(calls[0].init?.credentials, 'omit');
  assert.equal(calls[0].init?.redirect, 'manual');
  clock = 61_000;
  await client.get(url);
  assert.equal(calls.length, 2);
  for (const value of [
    'https://evil.example/sketch.js',
    'https://editor.p5js.org/p5/sketches/id%2Fother',
  ])
    await assert.rejects(client.get(value), /public p5/);
  assert.equal(calls.length, 2);
});

test('metadata lookup rejects private, unavailable and invalid responses', async () => {
  for (const response of [
    new Response('', { status: 404 }),
    new Response('', { status: 503 }),
    new Response('<html>'),
    new Response('{invalid', { headers: { 'content-type': 'application/json' } }),
  ]) {
    const client = createP5ImportClient({ fetcher: async () => response });
    await assert.rejects(client.get(url), /private|unavailable|invalid/);
  }
});

test('response reading enforces limits while streaming and validates UTF-8', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(100));
      controller.close();
    },
  });
  await assert.rejects(readP5Response(new Response(body), 99), /too large/);
  await assert.rejects(readP5Response(new Response(new Uint8Array([0xc3, 0x28])), 10), /UTF-8/);
});

test('client imports metadata only and rejects mismatched URLs and direct scripts', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json({ ...embed, source: 'ignored legacy payload' });
  });
  assert.deepEqual(await importP5Sketch(url), embed);
  assert.equal(calls[0], `/api/p5-sketch?url=${encodeURIComponent(url)}`);
  await assert.rejects(importP5Sketch('https://example.com/sketch.js'), /public p5/);
  assert.equal(calls.length, 1);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...embed, url: 'https://editor.p5js.org/other/sketches/id' }),
  );
  await assert.rejects(importP5Sketch(url), /invalid sketch/);
});
