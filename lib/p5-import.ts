import { AppError } from './app-error.ts';
import { normalizeP5Embed, parseP5Input, type P5Embed } from './p5.ts';

export { parseP5Input } from './p5.ts';

export const P5_IMPORT_TIMEOUT_MS = 10_000;

/** Enforce the limit while streaming, including when Content-Length is absent or false. */
export async function readP5Response(response: Response, maximum: number): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (length > maximum) {
    await response.body?.cancel();
    throw new AppError('The p5.js response is too large.');
  }
  if (!response.body) throw new AppError('The p5.js response is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new AppError('The p5.js response is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError('The p5.js response must be UTF-8.');
  }
}

export async function importP5Sketch(input: string, signal?: AbortSignal): Promise<P5Embed> {
  const url = parseP5Input(input);
  if (!url) throw new AppError('Paste a public p5.js editor link or its iframe embed.');
  const combined = AbortSignal.any([
    AbortSignal.timeout(P5_IMPORT_TIMEOUT_MS),
    ...(signal ? [signal] : []),
  ]);
  try {
    const response = await fetch(`/api/p5-sketch?url=${encodeURIComponent(url)}`, {
      signal: combined,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const text = await readP5Response(response, 8192);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AppError('Could not import this sketch. Try again shortly.');
    }
    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'error' in payload ? payload.error : null;
      throw new AppError(
        typeof message === 'string' && message.length < 400
          ? message
          : 'Could not import this sketch. Try again shortly.',
        response.status,
      );
    }
    const embed = normalizeP5Embed(payload);
    if (!embed || embed.url !== url) throw new AppError('The editor returned an invalid sketch.');
    return embed;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof AppError) throw error;
    if (combined.aborted) throw new AppError('Import timed out. Try again shortly.');
    throw new AppError('Could not read the p5.js sketch. Try again shortly.');
  }
}
