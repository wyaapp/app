import test from 'node:test';
import assert from 'node:assert/strict';
import { requestFiles } from '../lib/file-client.ts';
import type { FileAction, SpaceFile } from '../lib/space-files.ts';

const endpoint = '/api/files?spaceId=space';
const action = {
  action: 'save',
  id: 'bcb5c8b5-0d87-4765-84ac-13ea80e68695',
  version: 2,
  name: 'draft.md',
  content: '# My unsaved changes\n',
} satisfies FileAction;
const saved: SpaceFile = {
  id: action.id,
  name: action.name,
  content: action.content,
  version: 3,
  folderId: null,
  size: 21,
  published: false,
  hasChanges: true,
  pinned: false,
  updatedAt: '2026-10-27T12:00:00.000Z',
};

function expectRecoverable(error: unknown) {
  assert.ok(error instanceof Error);
  assert.ok(!(error instanceof SyntaxError));
  assert.doesNotMatch(error.message, /<!doctype|<html|unexpected token|not valid json/i);
  assert.match(error.message, /save|sign in|changes/i);
  return true;
}

test('file saves send the current draft as JSON and return the confirmed server version', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, endpoint);
    assert.equal(options?.method, 'POST');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('Accept'), 'application/json');
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(String(options?.body)), action);
    return Response.json({ file: saved });
  };
  assert.deepEqual(await requestFiles(endpoint, action, fetcher), { file: saved });
  assert.equal(calls, 1);
});

test('file reads ask for JSON without caching or sending a mutation', async () => {
  const result = { files: [saved], folders: [], defaultFileId: null };
  const fetcher: typeof fetch = async (_url, options) => {
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.method, undefined);
    assert.equal(options?.body, undefined);
    assert.equal(new Headers(options?.headers).get('Accept'), 'application/json');
    return Response.json(result);
  };
  assert.deepEqual(await requestFiles(endpoint, undefined, fetcher), result);
});

test('HTML, plain text and empty responses never surface parser errors or confirm a save', async () => {
  for (const status of [200, 403, 502, 503]) {
    for (const contentType of ['text/html', 'text/plain']) {
      await assert.rejects(
        requestFiles(
          endpoint,
          action,
          async () =>
            new Response('<!DOCTYPE html><html>Gateway error</html>', {
              status,
              headers: { 'Content-Type': contentType },
            }),
        ),
        expectRecoverable,
      );
    }
  }
  await assert.rejects(
    requestFiles(endpoint, action, async () => new Response(null, { status: 204 })),
    expectRecoverable,
  );
});

test('malformed JSON and invalid success payloads cannot replace the saved draft', async () => {
  for (const body of ['{', '<!DOCTYPE html>', '']) {
    await assert.rejects(
      requestFiles(
        endpoint,
        action,
        async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }),
      ),
      expectRecoverable,
    );
  }
  for (const payload of [
    null,
    [],
    {},
    { file: null },
    { file: { ...saved, id: 'different-file' } },
    { file: { ...saved, name: null } },
    { file: { ...saved, content: null } },
    { file: { ...saved, version: 0 } },
    { file: { ...saved, version: '3' } },
    { file: { ...saved, version: 2.5 } },
  ]) {
    await assert.rejects(
      requestFiles(endpoint, action, async () => Response.json(payload)),
      expectRecoverable,
    );
  }
});

test('expired sessions explain how to sign in without asking users to discard their draft', async () => {
  for (const response of [
    Response.json({ error: 'Sign in to continue.' }, { status: 401 }),
    new Response('<html>Sign in</html>', { status: 401 }),
  ]) {
    await assert.rejects(
      requestFiles(endpoint, action, async () => response),
      /Sign in again.*Keep this window open/i,
    );
  }
});

test('redirected API responses do not count as a successful save', async () => {
  const response = Response.json({ file: saved });
  Object.defineProperty(response, 'redirected', { value: true });
  await assert.rejects(
    requestFiles(endpoint, action, async () => response),
    expectRecoverable,
  );
});

test('rate limiting is recognized even when the response is an HTML gateway page', async () => {
  await assert.rejects(
    requestFiles(
      endpoint,
      action,
      async () => new Response('<html>Rate limited</html>', { status: 429 }),
    ),
    /Too many file requests.*Wait a moment/i,
  );
});

test('JSON conflict errors preserve the actionable server message', async () => {
  const message = 'This file changed elsewhere. Reload before saving.';
  await assert.rejects(
    requestFiles(endpoint, action, async () => Response.json({ error: message }, { status: 409 })),
    { message },
  );
});

test('network failures do not automatically repeat a mutation; an explicit retry can succeed', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1) throw new TypeError('Failed to fetch');
    return Response.json({ file: saved });
  };
  await assert.rejects(requestFiles(endpoint, action, fetcher), /Check your connection/i);
  assert.equal(calls, 1);
  assert.equal(action.content, '# My unsaved changes\n');
  assert.deepEqual(await requestFiles(endpoint, action, fetcher), { file: saved });
  assert.equal(calls, 2);
});
