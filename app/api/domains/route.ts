import { getChatGPTUser } from '../../chatgpt-auth';
import { domains } from '@/lib/domains';
import { AppError } from '@/lib/app-error';
import { readText } from '@/lib/request-body';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function handle(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in to continue.' }, 401);
  if (
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin)
  )
    return json({ error: 'Invalid request origin.' }, 403);
  try {
    const spaceId = new URL(request.url).searchParams.get('spaceId');
    if (!spaceId || spaceId.length > 200) throw new AppError('Choose a space first.');
    if (request.method === 'GET') return json(await domains().get(user.userId, spaceId));
    if (!request.headers.get('content-type')?.includes('application/json'))
      return json({ error: 'Expected JSON.' }, 415);
    const input = JSON.parse(await readText(request, 2048));
    if (
      !input ||
      typeof input.action !== 'string' ||
      (input.hostname !== undefined && typeof input.hostname !== 'string')
    )
      throw new AppError('Invalid domain settings.');
    return json(await domains().change(user.userId, spaceId, input));
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: 'Invalid JSON.' }, 400);
    return json({ error: 'Could not update domain settings. Please try again.' }, 503);
  }
}
export const GET = handle;
export const POST = handle;
