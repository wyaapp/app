import { normalizeCodeLanguage, syntaxLimits, type SyntaxToken } from './syntax-languages.ts';

export { normalizeCodeLanguage, syntaxLanguages, syntaxLimits } from './syntax-languages.ts';
export type { SyntaxLanguage, SyntaxToken } from './syntax-languages.ts';

type Result = readonly SyntaxToken[] | null;
const cache = new Map<string, { tokens: Result; cost: number }>();
const pending = new Map<string, Promise<Result>>();
const maxCacheEntries = 64;
const maxCacheCost = 512_000;
let cacheCost = 0;

function remember(key: string, tokens: Result) {
  const cost = key.length + (tokens?.length ?? 0) * 32;
  if (cost > maxCacheCost) return;
  cache.set(key, { tokens, cost });
  cacheCost += cost;
  while (cache.size > maxCacheEntries || cacheCost > maxCacheCost) {
    const oldest = cache.keys().next().value!;
    cacheCost -= cache.get(oldest)!.cost;
    cache.delete(oldest);
  }
}

/** Presentation only. No requests to application APIs and no document mutations. */
export function highlightCode(source: string, language?: string | null): Promise<Result> {
  const normalized = normalizeCodeLanguage(language);
  if (!normalized || !source || source.length > syntaxLimits.characters) {
    return Promise.resolve(null);
  }
  const lines = source.split(/\r\n|\r|\n/);
  if (
    lines.length > syntaxLimits.lines ||
    lines.some((line) => line.length > syntaxLimits.lineLength)
  ) {
    return Promise.resolve(null);
  }
  const key = normalized + '\0' + source;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return Promise.resolve(cached.tokens);
  }
  const existing = pending.get(key);
  if (existing) return existing;
  // A large imported document must not create an unbounded queue of work.
  if (pending.size >= maxCacheEntries) return Promise.resolve(null);
  const result = (
    typeof window === 'undefined'
      ? import('./syntax-highlighter-engine.ts').then(({ tokenizeCode }) =>
          tokenizeCode(source, normalized),
        )
      : import('./syntax-highlighter-client.ts').then(({ tokenizeInWorker }) =>
          tokenizeInWorker(source, normalized),
        )
  )
    .then((tokens) => {
      remember(key, tokens);
      return tokens;
    })
    .catch(() => null)
    .finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}
