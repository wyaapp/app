import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceFileReads, currentBootstrapDocuments } from '../lib/file-document-loading.ts';
import { fileInfo, type SpaceFile } from '../lib/space-files.ts';

const document: SpaceFile = {
  id: 'e0c29d43-7fb4-46ef-ac39-24bbdf4763bb',
  name: 'welcome.md',
  content: '# Welcome',
  folderId: null,
  size: 9,
  version: 0,
  published: true,
  hasChanges: false,
  pinned: false,
  updatedAt: '2026-10-28T12:00:00.000Z',
};

test('SSR file content is reused with fresh folder and shortcut metadata', () => {
  const metadata = { ...fileInfo(document), folderId: 'desktop', pinned: true, position: 4 };
  assert.deepEqual(currentBootstrapDocuments([document], [metadata]), [
    { ...document, ...metadata },
  ]);
  assert.equal(document.folderId, null);
});

test('removed or republished files cannot reuse a stale public snapshot with version zero', () => {
  assert.deepEqual(currentBootstrapDocuments([document], []), []);
  for (const change of [
    { updatedAt: '2026-10-28T12:01:00.000Z' },
    { name: 'new-name.md' },
    { size: 20 },
    { appearance: { theme: 'black' as const } },
    { version: 2 },
  ]) {
    assert.deepEqual(
      currentBootstrapDocuments([document], [{ ...fileInfo(document), ...change }]),
      [],
    );
  }
});

test('concurrent restoration and open actions share one request, without becoming a stale cache', async () => {
  let calls = 0;
  let finish!: (file: SpaceFile) => void;
  const read = coalesceFileReads(async () => {
    calls++;
    return new Promise<SpaceFile>((resolve) => {
      finish = resolve;
    });
  });
  const restored = read('/api/public-files?handle=alice', document.id);
  const opened = read('/api/public-files?handle=alice', document.id);
  assert.equal(restored, opened);
  assert.equal(calls, 1);
  finish(document);
  assert.equal(await opened, document);
  const refreshed = read('/api/public-files?handle=alice', document.id);
  assert.equal(calls, 2);
  finish({ ...document, name: 'latest.md' });
  assert.equal((await refreshed).name, 'latest.md');
});

test('owner, visitor and other spaces never share pending document responses', async () => {
  const urls: string[] = [];
  const read = coalesceFileReads(async (url) => {
    urls.push(url);
    return { ...document, content: url };
  });
  const endpoints = [
    '/api/files?spaceId=alice',
    '/api/public-files?handle=alice',
    '/api/public-files?handle=bob',
  ];
  const results = await Promise.all(endpoints.map((endpoint) => read(endpoint, document.id)));
  assert.equal(urls.length, 3);
  for (let i = 0; i < endpoints.length; i++) {
    assert.equal(results[i].content, `${endpoints[i]}&id=${document.id}`);
  }
});

test('failed shared reads are released so explicit retries can succeed', async () => {
  let calls = 0;
  const read = coalesceFileReads(async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return document;
  });
  const first = read('/api/files?spaceId=alice', document.id);
  const second = read('/api/files?spaceId=alice', document.id);
  assert.equal(first, second);
  await assert.rejects(first, /offline/);
  assert.equal(await read('/api/files?spaceId=alice', document.id), document);
  assert.equal(calls, 2);
});
