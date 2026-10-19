import { getChatGPTUser } from '../../../chatgpt-auth';
import { saveOnboarding } from '@/lib/service';
import { AppError } from '@/lib/app-error';
import { readText } from '@/lib/request-body';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in to continue.' }, 401);
  if (
    request.headers.get('origin') !== new URL(request.url).origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    return json({ error: 'Invalid request origin.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json'))
    return json({ error: 'Expected JSON.' }, 415);
  try {
    const input = JSON.parse(await readText(request, 1024));
    return json({ onboarding: await saveOnboarding(user.userId, input) });
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: 'Invalid JSON.' }, 400);
    console.error('Onboarding update failed');
    return json({ error: 'Could not save your answers. Please try again.' }, 500);
  }
}
