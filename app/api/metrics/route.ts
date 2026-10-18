import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { getAccount } from '@/lib/service';
import { AppError } from '@/lib/model';
import { consumeLimit, digestKey } from '@/lib/abuse-limits';
import { createMetricsService } from '@/lib/space-metrics';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const getMetrics = createMetricsService({
  getOwnedSpace: getAccount,
  config: () => ({
    host: env.POSTHOG_HOST,
    projectId: env.POSTHOG_PROJECT_ID,
    readKey: env.POSTHOG_READ_KEY,
    token: env.POSTHOG_PROJECT_TOKEN,
  }),
  beforeQuery: async () => {
    if (!env.DB) throw new AppError('Metrics are unavailable.', 503);
    // Shared across Worker instances; leave headroom under PostHog's query API quota.
    await consumeLimit(env.DB, 'metrics-query-minute', 30, 60_000);
    await consumeLimit(env.DB, 'metrics-query-hour', 1000, 3_600_000);
  },
});
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in to view metrics.' }, 401);
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    return json({ error: 'Invalid request origin.' }, 403);
  const query = new URL(request.url).searchParams;
  const days = Number(query.get('days') ?? 7),
    spaceId = query.get('spaceId');
  if ((days !== 7 && days !== 30) || !spaceId || spaceId.length > 200)
    return json({ error: 'Choose a space and a 7- or 30-day range.' }, 400);
  try {
    if (env.DB)
      await consumeLimit(env.DB, `metrics-read:${await digestKey(user.userId)}`, 30, 60_000);
    return json(await getMetrics(user.userId, spaceId, days));
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    // Never log upstream response bodies, request authorization, or query data.
    return json({ error: 'Metrics are temporarily unavailable. Please try again.' }, 503);
  }
}
