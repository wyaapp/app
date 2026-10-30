import { getChatGPTUser } from '../../../chatgpt-auth';
import { getHistory } from '@/lib/service';
import { AppError } from '@/lib/app-error';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in to continue.' }, 401);
  try {
    return json({
      history: await getHistory(
        user.userId,
        new URL(request.url).searchParams.get('spaceId') || undefined,
      ),
    });
  } catch (error) {
    return json(
      { error: error instanceof AppError ? error.message : 'Could not load history.' },
      error instanceof AppError ? error.status : 503,
    );
  }
}
