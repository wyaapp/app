import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../chatgpt-auth';
import { AppError } from '@/lib/app-error';
import { RateLimitError } from '@/lib/abuse-limits';
import { readText } from '@/lib/request-body';
import { submitReport } from '@/lib/discord-report';
import { resolveHostingMode } from '@/lib/plans';

type WebhookBinding = 'DISCORD_FEEDBACK_WEBHOOK';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });

/** The route selects a server secret. Clients cannot choose the destination. */
export function createReportHandler(webhookBinding: WebhookBinding) {
  return async function POST(request: Request) {
    const user = await getChatGPTUser();
    if (!user) return json({ error: 'Sign in to send a message.' }, 401);
    if (
      request.headers.get('origin') !== new URL(request.url).origin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return json({ error: 'Invalid request origin.' }, 403);
    if (
      request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    )
      return json({ error: 'Expected JSON.' }, 415);
    try {
      if (!env.DB)
        throw new AppError('Messaging is unavailable. Please email support@wya.im.', 503);
      const input = JSON.parse(await readText(request, 12_000));
      return json(
        await submitReport(input, user, {
          db: env.DB,
          webhook: env[webhookBinding],
          origin: env.WYA_ORIGIN || new URL(request.url).origin,
          hostingMode: resolveHostingMode(env.WYA_HOSTING_MODE),
        }),
      );
    } catch (error) {
      if (error instanceof RateLimitError)
        return json({ error: error.message, retryAfter: error.retryAfter }, error.status, {
          'Retry-After': String(error.retryAfter),
        });
      if (error instanceof AppError) return json({ error: error.message }, error.status);
      if (error instanceof SyntaxError) return json({ error: 'Invalid JSON.' }, 400);
      return json({ error: 'Could not send your message. Please try again later.' }, 500);
    }
  };
}
