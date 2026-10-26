import { getChatGPTUser } from '../../chatgpt-auth';
import { billing } from '@/lib/billing';
import { getAccountPlan } from '@/lib/service';
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
    const service = billing();
    if (request.method === 'GET') {
      const status = await service.get(user.userId);
      return json({ ...status, plan: await getAccountPlan(user.userId) });
    }
    if (!request.headers.get('content-type')?.includes('application/json'))
      return json({ error: 'Expected JSON.' }, 415);
    const input = JSON.parse(await readText(request, 1024));
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new AppError('Choose a billing action.');
    if (input.action === 'portal' && Object.keys(input).length === 1)
      return json(await service.portal(user.userId));
    if (
      input.action === 'checkout' &&
      Object.keys(input).every((key) => ['action', 'currency', 'interval'].includes(key)) &&
      ['usd', 'brl'].includes(input.currency) &&
      ['month', 'year'].includes(input.interval)
    )
      return json(
        await service.checkout(user.userId, { currency: input.currency, interval: input.interval }),
      );
    throw new AppError('Choose a supported currency and billing interval.');
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: 'Invalid JSON.' }, 400);
    // Stripe responses can contain customer data. Never return or log their bodies.
    return json({ error: 'Billing is temporarily unavailable. Please try again.' }, 503);
  }
}
export const GET = handle;
export const POST = handle;
