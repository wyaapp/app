import { AppError } from './app-error.ts';
import { readP5Response, P5_IMPORT_TIMEOUT_MS } from './p5-import.ts';
import { normalizeP5Embed, parseP5Url, p5EditorProject, type P5Embed } from './p5.ts';

const MAX_PROJECT_BYTES = 1024 * 1024;
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 16;
/** Read the title only. p5 hosts and runs all project files and dependencies. */
export function p5FromEditorProject(value: unknown, inputUrl: string): P5Embed {
  const url = parseP5Url(inputUrl);
  if (!url) throw new AppError('Use a public p5.js editor link.');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError('The editor returned an invalid sketch.', 502);
  const project = value as Record<string, unknown>;
  if (project.visibility === 'Private')
    throw new AppError('This sketch is private. Share a public p5.js sketch.', 403);
  const title =
    typeof project.name === 'string'
      ? project.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100)
      : 'p5.js sketch';
  return normalizeP5Embed({ url, title })!;
}

/** Only the official fixed host is requested. No caller-controlled fetch target or redirect. */
export function createP5ImportClient({
  fetcher = fetch,
  now = Date.now,
  beforeRequest,
}: {
  fetcher?: typeof fetch;
  now?: () => number;
  beforeRequest?: () => Promise<void>;
} = {}) {
  const cache = new Map<string, { expires: number; embed: P5Embed }>();
  return {
    async get(input: string): Promise<P5Embed> {
      const url = parseP5Url(input);
      const identity = url && p5EditorProject(url);
      if (!url || !identity) throw new AppError('Use a public p5.js editor link.');
      const hit = cache.get(url);
      if (hit && hit.expires > now()) return { ...hit.embed };
      let response: Response | undefined;
      try {
        await beforeRequest?.();
        response = await fetcher(
          `https://editor.p5js.org/editor/${identity.username}/projects/${identity.id}`,
          {
            headers: { Accept: 'application/json' },
            credentials: 'omit',
            // Workers supports manual/follow only. Non-2xx responses below are rejected.
            redirect: 'manual',
            signal: AbortSignal.timeout(P5_IMPORT_TIMEOUT_MS),
          },
        );
        if (response.status === 403 || response.status === 404)
          throw new AppError(
            'This sketch is private or unavailable. Share a public p5.js sketch.',
            422,
          );
        if (!response.ok)
          throw new AppError('The p5.js editor is unavailable. Try again shortly.', 503);
        if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
          throw new AppError('The editor returned an invalid sketch.', 502);
        const text = await readP5Response(response, MAX_PROJECT_BYTES);
        let project: unknown;
        try {
          project = JSON.parse(text);
        } catch {
          throw new AppError('The editor returned an invalid sketch.', 502);
        }
        const embed = p5FromEditorProject(project, url);
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(url, { expires: now() + CACHE_MS, embed });
        return { ...embed };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('Could not read the p5.js sketch. Try again shortly.', 503);
      } finally {
        if (response?.body && !response.bodyUsed) await response.body.cancel();
      }
    },
  };
}
