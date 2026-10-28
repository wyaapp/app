import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

// Run the actual route and request parser with isolated auth and database boundaries.
const { outputFiles } = buildSync({
  stdin: {
    contents: `
      export { GET, POST } from './app/api/files/route';
      export { AppError } from './lib/app-error';
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['cloudflare:workers', '../../chatgpt-auth', '@/lib/space-file-service'],
  logLevel: 'silent',
});
const require = createRequire(import.meta.url);

function route({ authenticate = async () => ({ userId: 'owner' }), change } = {}) {
  const calls = [];
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', 'console', outputFiles[0].text)(
    (name) => {
      if (name === 'cloudflare:workers') return { env: { DB: {} } };
      if (name === '../../chatgpt-auth') return { getChatGPTUser: authenticate };
      if (name === '@/lib/space-file-service')
        return {
          createSpaceFileService: () => ({
            change: async (...args) => {
              calls.push(args);
              return change ? change(...args) : { file: { id: 'saved-file' } };
            },
          }),
        };
      return require(name);
    },
    compiled,
    compiled.exports,
    { error() {} },
  );
  return { ...compiled.exports, calls };
}

function request({ method = 'POST', origin = 'https://wya.im', site, body = '{}' } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (origin !== null) headers.set('Origin', origin);
  if (site) headers.set('Sec-Fetch-Site', site);
  return new Request('https://wya.im/api/files?spaceId=space', {
    method,
    headers,
    ...(method === 'POST' ? { body } : {}),
  });
}

async function expectJson(response, status, body) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('Content-Type'), /^application\/json\b/);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await response.json(), body);
}

test('file reads and saves return JSON when session lookup fails', async () => {
  const { GET, POST, calls } = route({
    authenticate: async () => {
      throw new Error('Session database unavailable');
    },
  });
  for (const method of ['GET', 'POST']) {
    await expectJson(await { GET, POST }[method](request({ method })), 503, {
      error: 'Could not load or save files. Please try again.',
    });
  }
  assert.deepEqual(calls, []);
});

test('file reads and saves keep unauthenticated responses as JSON 401', async () => {
  const { GET, POST, calls } = route({ authenticate: async () => null });
  for (const method of ['GET', 'POST']) {
    await expectJson(await { GET, POST }[method](request({ method })), 401, {
      error: 'Sign in to continue.',
    });
  }
  assert.deepEqual(calls, []);
});

test('file saves reject cross-site, missing-origin and mismatched-origin requests', async () => {
  const { POST, calls } = route();
  for (const options of [
    { site: 'cross-site' },
    { origin: null },
    { origin: 'https://other.example' },
  ]) {
    await expectJson(await POST(request(options)), 403, { error: 'Invalid request origin.' });
  }
  assert.deepEqual(calls, []);
});

test('file saves return JSON 503 without exposing unexpected service errors', async () => {
  const { POST } = route({
    change: async () => {
      throw new Error('Internal database failure');
    },
  });
  await expectJson(await POST(request()), 503, {
    error: 'Could not load or save files. Please try again.',
  });
});

test('internal auth and service parsing failures are not reported as invalid request JSON', async () => {
  const fail = async () => {
    throw new SyntaxError('Invalid internal JSON');
  };
  for (const options of [{ authenticate: fail }, { change: fail }]) {
    const { POST } = route(options);
    await expectJson(await POST(request()), 503, {
      error: 'Could not load or save files. Please try again.',
    });
  }
});

test('file saves preserve expected service errors and their status codes', async () => {
  const api = route({
    change: async () => {
      throw new api.AppError('This file changed elsewhere. Reload before saving.', 409);
    },
  });
  await expectJson(await api.POST(request()), 409, {
    error: 'This file changed elsewhere. Reload before saving.',
  });
});

test('file saves reject malformed JSON without reaching the service', async () => {
  const { POST, calls } = route();
  await expectJson(await POST(request({ body: '{' })), 400, { error: 'Invalid JSON.' });
  assert.deepEqual(calls, []);
});

test('file saves pass the authenticated owner and decoded action to the service', async () => {
  const { POST, calls } = route();
  const action = {
    action: 'save',
    id: '11111111-1111-4111-8111-111111111111',
    version: 2,
    name: 'draft.md',
    content: '# Draft',
  };
  await expectJson(await POST(request({ body: JSON.stringify(action) })), 200, {
    file: { id: 'saved-file' },
  });
  assert.deepEqual(calls, [['owner', 'space', action]]);
});
