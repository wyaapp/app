import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { SyntaxToken } from '../lib/syntax-languages.ts';

type Client = typeof import('../lib/syntax-highlighter-client.ts');
type Request = { id: number; source: string; language: string };
type Response = { id: number; tokens: readonly SyntaxToken[] | null };
let importId = 0;

function freshClient(): Promise<Client> {
  const url = new URL('../lib/syntax-highlighter-client.ts', import.meta.url);
  url.searchParams.set('transport-test', String(++importId));
  return import(url.href);
}

function mockWorker(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'Worker', original);
    else Reflect.deleteProperty(globalThis, 'Worker');
  });
  class FakeWorker {
    static instances: FakeWorker[] = [];
    static failConstruction = false;
    static failPost = false;
    url: URL;
    options: WorkerOptions;
    sent: Request[] = [];
    terminated = false;
    listeners = new Map<string, ((event: { data: Response }) => void)[]>();

    constructor(url: URL, options: WorkerOptions) {
      if (FakeWorker.failConstruction) throw new Error('Blocked worker');
      this.url = url;
      this.options = options;
      FakeWorker.instances.push(this);
    }

    addEventListener(type: string, callback: (event: { data: Response }) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
    }

    postMessage(request: Request) {
      if (FakeWorker.failPost) throw new Error('Worker no longer accepts messages');
      this.sent.push(structuredClone(request));
    }

    terminate() {
      this.terminated = true;
    }

    emit(type: string, data: Response = { id: -1, tokens: null }) {
      for (const callback of this.listeners.get(type) ?? [])
        callback({ data: structuredClone(data) });
    }
  }
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: FakeWorker,
  });
  return FakeWorker;
}

const keyword: SyntaxToken = { from: 0, to: 5, color: 'var(--syntax-token-keyword, #713faf)' };

test('worker transport is lazy, shared, and correlates out-of-order replies without changing source', async (t) => {
  const Worker = mockWorker(t);
  const { tokenizeInWorker } = await freshClient();
  assert.equal(Worker.instances.length, 0);
  const firstSource = 'const 🌩️ = "<script>";\r\n';
  const first = tokenizeInWorker(firstSource, 'javascript');
  const second = tokenizeInWorker('return 42;', 'typescript');
  assert.equal(Worker.instances.length, 1);
  const worker = Worker.instances[0];
  assert.equal(worker.options.type, 'module');
  assert.ok(worker.url.pathname.endsWith('/syntax-highlighter.worker.ts'));
  assert.equal(worker.sent[0].source, firstSource);
  assert.equal(worker.sent[0].language, 'javascript');
  assert.notEqual(worker.sent[0].id, worker.sent[1].id);

  worker.emit('message', { id: 999_999, tokens: [keyword] });
  worker.emit('message', { id: worker.sent[1].id, tokens: null });
  assert.equal(await second, null);
  worker.emit('message', { id: worker.sent[0].id, tokens: [keyword] });
  assert.deepEqual(await first, [keyword]);
  worker.emit('message', { id: worker.sent[0].id, tokens: null });
  assert.equal(worker.terminated, false);
});

test('worker failures settle all pending requests as plain code and stop subsequent work', async (t) => {
  for (const event of ['error', 'messageerror']) {
    await t.test(event, async (t) => {
      const Worker = mockWorker(t);
      const { tokenizeInWorker } = await freshClient();
      const first = tokenizeInWorker('const first = 1;', 'javascript');
      const second = tokenizeInWorker('const second = 2;', 'typescript');
      const worker = Worker.instances[0];
      worker.emit(event);
      assert.deepEqual(await Promise.all([first, second]), [null, null]);
      assert.equal(worker.terminated, true);
      assert.equal(await tokenizeInWorker('const after = 3;', 'javascript'), null);
      assert.equal(worker.sent.length, 2);
      assert.equal(Worker.instances.length, 1);
    });
  }
});

test('unavailable workers and constructor or postMessage exceptions do not reject rendering', async (t) => {
  for (const failure of ['unavailable', 'constructor', 'postMessage']) {
    await t.test(failure, async (t) => {
      const Worker = mockWorker(t);
      if (failure === 'unavailable') Reflect.deleteProperty(globalThis, 'Worker');
      if (failure === 'constructor') Worker.failConstruction = true;
      if (failure === 'postMessage') Worker.failPost = true;
      const { tokenizeInWorker } = await freshClient();
      assert.equal(await tokenizeInWorker('const fallback = true;', 'javascript'), null);
      if (failure === 'postMessage') assert.equal(Worker.instances[0].terminated, true);
    });
  }
});

test('a stuck worker times out, terminates, and releases every pending source', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const Worker = mockWorker(t);
  const { tokenizeInWorker } = await freshClient();
  const first = tokenizeInWorker('const first = 1;', 'javascript');
  const second = tokenizeInWorker('const second = 2;', 'typescript');
  const worker = Worker.instances[0];
  t.mock.timers.tick(14_999);
  assert.equal(worker.terminated, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await Promise.all([first, second]), [null, null]);
  assert.equal(worker.terminated, true);
  worker.emit('message', { id: worker.sent[0].id, tokens: [keyword] });
  assert.equal(await tokenizeInWorker('const after = 3;', 'javascript'), null);
  assert.equal(Worker.instances.length, 1);
});

test('successful replies clear their deadlines instead of terminating a healthy shared worker', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const Worker = mockWorker(t);
  const { tokenizeInWorker } = await freshClient();
  const first = tokenizeInWorker('const first = 1;', 'javascript');
  const worker = Worker.instances[0];
  t.mock.timers.tick(10_000);
  worker.emit('message', { id: worker.sent[0].id, tokens: [keyword] });
  assert.deepEqual(await first, [keyword]);
  const second = tokenizeInWorker('const second = 2;', 'javascript');
  t.mock.timers.tick(10_000);
  assert.equal(worker.terminated, false);
  worker.emit('message', { id: worker.sent[1].id, tokens: [keyword] });
  assert.deepEqual(await second, [keyword]);
  t.mock.timers.tick(20_000);
  assert.equal(worker.terminated, false);
});
