import { AppError } from './app-error.ts';

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
  if (!row) throw new AppError('Too many requests. Please try again later.', 429);
}

export async function limitMutation(db: D1Database, userId: string, now = Date.now()) {
  const owner = await digestKey(userId);
  await consumeLimit(db, `write-minute:${owner}`, 30, 60_000, now);
  await consumeLimit(db, `write-day:${owner}`, 300, 86_400_000, now);
}
