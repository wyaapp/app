import { z } from 'zod';
import { AppError } from './app-error.ts';
import { consumeLimit, digestKey } from './abuse-limits.ts';

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
  }: {
    db: D1Database;
    webhook?: string;
    fetcher?: typeof fetch;
  },
) {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) throw new AppError('Write between 10 and 1,800 characters.', 400);
  if (!webhook || !/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(webhook))
    throw new AppError('Feedback is unavailable. Please email contact@wya.im.', 503);

  const owner = await digestKey(userId);
  await consumeLimit(db, `feedback-hour:${owner}`, 3, 3_600_000);
  await consumeLimit(db, `feedback-day:${owner}`, 10, 86_400_000);
  await consumeLimit(db, 'feedback-minute', 30, 60_000);

  try {
    const response = await fetcher(`${webhook}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'wya.im feedback',
        content: parsed.data.message,
        allowed_mentions: { parse: [] },
        flags: 4, // Suppress automatic link previews.
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel();
    if (response.status === 429)
      throw new AppError('Feedback is busy. Please try again in a few minutes.', 429);
    if (!response.ok) throw new Error('Delivery failed');
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Network errors may contain the secret webhook URL. Never return or log them.
    throw new AppError('Could not confirm delivery. Please try again later.', 502);
  }
}
