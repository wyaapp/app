import type { SyntaxLanguage, SyntaxToken } from './syntax-languages.ts';

type Result = readonly SyntaxToken[] | null;
let worker: Worker | undefined;
let failed = false;
let nextId = 0;
const requests = new Map<
  number,
  {
    resolve: (result: Result) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

function stopWorker() {
  failed = true;
  worker?.terminate();
  worker = undefined;
  for (const request of requests.values()) {
    clearTimeout(request.timeout);
    request.resolve(null);
  }
  requests.clear();
}

/** Keep grammar compilation and tokenization off the typing/rendering thread. */
export function tokenizeInWorker(source: string, language: SyntaxLanguage): Promise<Result> {
  if (failed || typeof Worker === 'undefined') return Promise.resolve(null);
  try {
    if (!worker) {
      worker = new Worker(new URL('./syntax-highlighter.worker.ts', import.meta.url), {
        type: 'module',
        name: 'wya-syntax',
      });
      worker.addEventListener('error', stopWorker);
      worker.addEventListener('messageerror', stopWorker);
      worker.addEventListener('message', (event: MessageEvent<{ id: number; tokens: Result }>) => {
        const request = requests.get(event.data.id);
        if (!request) return;
        requests.delete(event.data.id);
        clearTimeout(request.timeout);
        const tokens = event.data.tokens;
        if (tokens) {
          for (const token of tokens) Object.freeze(token);
          Object.freeze(tokens);
        }
        request.resolve(tokens);
      });
    }
    return new Promise((resolve) => {
      const id = ++nextId;
      // A pathological grammar or failed chunk must leave readable plain code,
      // rather than tie up a worker or retain pending document contents forever.
      requests.set(id, { resolve, timeout: setTimeout(stopWorker, 15_000) });
      try {
        worker!.postMessage({ id, source, language });
      } catch {
        stopWorker();
      }
    });
  } catch {
    stopWorker();
    return Promise.resolve(null);
  }
}
