import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { createSpaceFileService } from '@/lib/space-file-service';
import { AppError } from '@/lib/app-error';
import { MAX_FILE_BYTES } from '@/lib/space-files';
import { readText } from '@/lib/request-body';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
async function handle(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in to continue.' }, 401);
  if (
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin)
  )
    return json({ error: 'Invalid request origin.' }, 403);
  try {
    const params = new URL(request.url).searchParams;
    const spaceId = params.get('spaceId');
    if (!spaceId || spaceId.length > 200) throw new AppError('Choose a space first.');
    const id = params.get('id') || undefined;
    if (id && !/^[a-f0-9-]{36}$/.test(id)) throw new AppError('File not found.', 404);
    const service = createSpaceFileService(env.DB!);
    if (request.method === 'GET') return json(await service.get(user.userId, spaceId, id));
    if (!request.headers.get('content-type')?.includes('application/json'))
      return json({ error: 'Expected JSON.' }, 415);
    const input = JSON.parse(await readText(request, MAX_FILE_BYTES * 6 + 2048));
    return json(await service.change(user.userId, spaceId, input));
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: 'Invalid JSON.' }, 400);
    console.error('File request failed', error);
    return json({ error: 'Could not load or save files. Please try again.' }, 503);
  }
}
export const GET = handle;
export const POST = handle;
