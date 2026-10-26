import { AppError } from './app-error.ts';

export class RateLimitError extends AppError {
  readonly retryAfter: number;

  constructor(retryAfter: number, message = 'Too many requests. Please try again later.') {
    super(message, 429);
    this.retryAfter = Math.max(1, Math.ceil(retryAfter));
  }
}

export async function digestKey(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
}

/** An atomic fixed-window counter shared by every Worker instance. */
export async function consumeLimit(
  db: D1Database,
  key: string,
  maximum: number,
  windowMs: number,
  now = Date.now(),
) {
  const window = Math.floor(now / windowMs);
  const row = await db
    .prepare(
      'INSERT INTO security_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count',
    )
    .bind(`${key}:${window}`, (window + 1) * windowMs, maximum)
    .first();
  if (!row) throw new RateLimitError(((window + 1) * windowMs - now) / 1000);
}

type Limit = { key: string; maximum: number; windowMs: number };

/** Reserve before delivery so concurrent requests cannot exceed the budget.
 * The returned release function refunds only this reservation, at most once.
 */
export async function reserveLimits(db: D1Database, limits: readonly Limit[], now = Date.now()) {
  const reserved: string[] = [];
  let releasePromise: Promise<void> | undefined;
  const release = () => {
    releasePromise ??= (async () => {
      await Promise.all(
        reserved.map(async (key) => {
          await db
            .prepare(
              'UPDATE security_limits SET count = MAX(0, count - 1) WHERE key = ? RETURNING count',
            )
            .bind(key)
            .first();
        }),
      );
    })();
    return releasePromise;
  };
  try {
    for (const { key, maximum, windowMs } of limits) {
      await consumeLimit(db, key, maximum, windowMs, now);
      // Keep the original window even if delivery finishes after it expires.
      reserved.push(`${key}:${Math.floor(now / windowMs)}`);
    }
  } catch (error) {
    await release();
    throw error;
  }
  return release;
}

export async function limitMutation(db: D1Database, userId: string, now = Date.now()) {
  const owner = await digestKey(userId);
  await consumeLimit(db, `write-minute:${owner}`, 30, 60_000, now);
  await consumeLimit(db, `write-day:${owner}`, 300, 86_400_000, now);
}
