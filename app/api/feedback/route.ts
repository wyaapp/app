import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { AppError } from '@/lib/app-error';
import { readText } from '@/lib/request-body';
import { submitFeedback } from '@/lib/feedback';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in to send feedback.' }, 401);
  if (
    request.headers.get('origin') !== new URL(request.url).origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    return json({ error: 'Invalid request origin.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json'))
    return json({ error: 'Expected JSON.' }, 415);
  try {
    if (!env.DB) throw new AppError('Feedback is unavailable. Please try again later.', 503);
    const input = JSON.parse(await readText(request, 12_000));
    await submitFeedback(input, user.userId, {
      db: env.DB,
      webhook: env.DISCORD_FEEDBACK_WEBHOOK,
    });
    return json({ sent: true });
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: 'Invalid JSON.' }, 400);
    return json({ error: 'Could not send feedback. Please try again later.' }, 500);
  }
}
