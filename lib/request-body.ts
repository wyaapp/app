import { AppError } from './app-error.ts';

export const JSON_BODY_LIMIT = 16_000;
export const AUTH_BODY_LIMIT = 32_000;

/** Bound bytes before decoding or parsing, including requests without a length. */
export async function readBody(
  request: Pick<Request, 'headers' | 'body'>,
  limit = JSON_BODY_LIMIT,
): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > limit) {
    await request.body?.cancel();
    throw new AppError('Request too large.', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new AppError('Request too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function readText(request: Request, limit = JSON_BODY_LIMIT) {
  return new TextDecoder().decode(await readBody(request, limit));
}

/** Preserve cookies, OAuth form bodies and headers while bounding library parsing. */
export async function boundedAuthRequest(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD') return request;
  const bytes = await readBody(request, AUTH_BODY_LIMIT);
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return new Request(request.url, { method: request.method, headers, body: bytes as BodyInit });
}
