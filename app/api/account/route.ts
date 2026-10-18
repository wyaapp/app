import { accountMutation } from './mutation';
import { getChatGPTUser } from '../../chatgpt-auth';
import { getAccount, getHistory, listSpaces } from '@/lib/service';
import { AppError } from '@/lib/model';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in to continue.' }, 401);
  try {
    const spaceId = new URL(request.url).searchParams.get('spaceId') || undefined;
    const profile = await getAccount(user.userId, spaceId);
    return json({
      profile,
      spaces: await listSpaces(user.userId),
      history: profile ? await getHistory(user.userId, profile.id) : [],
    });
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    throw error;
  }
}
export async function POST(request: Request) {
  return accountMutation(request);
}
