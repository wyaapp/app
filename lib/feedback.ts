import { z } from 'zod';
import { AppError } from './app-error.ts';
import { consumeLimit, digestKey, RateLimitError, reserveLimits } from './abuse-limits.ts';

const feedbackSchema = z
  .object({
    message: z.string().trim().min(10).max(1800),
  })
  .strict();

export async function submitFeedback(
  input: unknown,
  userId: string,
  {
    db,
    webhook,
    fetcher = fetch,
    now = Date.now(),
  }: {
    db: D1Database;
    webhook?: string;
    fetcher?: typeof fetch;
    now?: number;
  },
) {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) throw new AppError('Write between 10 and 1,800 characters.', 400);
  if (
    !webhook ||
    webhook.trim() !== webhook ||
    !/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(webhook)
  )
    throw new AppError('Feedback is unavailable. Please email contact@wya.im.', 503);

  const owner = await digestKey(userId);
  // Attempts have a short cooldown; unsuccessful deliveries do not use the
  // account's hourly/daily allowance.
  await consumeLimit(db, `feedback-attempt-minute:${owner}`, 6, 60_000, now);
  const release = await reserveLimits(
    db,
    [
      { key: `feedback-hour:${owner}`, maximum: 20, windowMs: 3_600_000 },
      { key: `feedback-day:${owner}`, maximum: 100, windowMs: 86_400_000 },
    ],
    now,
  );

  try {
    // Keep the shared attempt cap even during an upstream outage. If it is
    // full, the account's pending delivery reservation is refunded below.
    await consumeLimit(db, 'feedback-minute', 30, 60_000, now);
    const response = await fetcher(`${webhook}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'wya.im feedback',
        content: parsed.data.message,
        allowed_mentions: { parse: [] },
        flags: 4, // Suppress automatic link previews.
      }),
      // Workers supports manual redirects, not redirect: 'error'. Reject 3xx
      // below so the webhook secret or message can never follow a redirect.
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    // A failed cleanup must not report an already accepted message as failed.
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) {
      const requestedDelay = Number(response.headers.get('Retry-After'));
      const retryAfter =
        Number.isFinite(requestedDelay) && requestedDelay > 0
          ? Math.min(86_400, requestedDelay)
          : 60;
      throw new RateLimitError(retryAfter, 'Feedback is busy. Please try again in a few minutes.');
    }
    if (!response.ok) throw new Error('Delivery failed');
  } catch (error) {
    await release();
    if (error instanceof AppError) throw error;
    // Network errors may contain the secret webhook URL. Never return or log them.
    throw new AppError('Could not confirm delivery. Please try again later.', 502);
  }
}
