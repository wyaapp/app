import { getChatGPTUser } from '../../chatgpt-auth';
import { getAccountSummary, listSpaces, getAccountPlan, getOnboarding } from '@/lib/service';
import { AppError } from '@/lib/app-error';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
/** Small private bootstrap. Files and history are loaded only by their respective screens. */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in to continue.' }, 401);
  try {
    const [spaces, plan, onboarding] = await Promise.all([
      listSpaces(user.userId),
      getAccountPlan(user.userId),
      getOnboarding(user.userId),
    ]);
    const requested = new URL(request.url).searchParams.get('spaceId');
    const spaceId = requested || spaces[0]?.id;
    const profile = spaceId ? await getAccountSummary(user.userId, spaceId) : null;
    if (requested && !profile) return json({ error: 'Space not found.' }, 404);
    return json({
      initial: profile,
      initialSpaces: spaces,
      initialPlan: plan,
      initialOnboarding: onboarding,
      initialHistory: [],
    });
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    return json({ error: 'Could not load this space.' }, 503);
  }
}
