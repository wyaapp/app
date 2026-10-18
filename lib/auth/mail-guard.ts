import { APIError } from 'better-auth/api';
import { consumeLimit, digestKey } from '../abuse-limits.ts';
import { AppError } from '../app-error.ts';
import { reserveEmail } from './email.ts';

export type MailGuard = {
  acquire(email: string, headers: Headers): Promise<() => Promise<void>>;
  reserve(email: string): Promise<void>;
};

export async function verifyTurnstile(
  secret: string | undefined,
  origin: string,
  headers: Headers,
  fetcher: typeof fetch = fetch,
) {
  const token = headers.get('cf-turnstile-response');
  if (!secret)
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: 'Sign-in verification is not configured.',
    });
  if (!token || token.length > 2048)
    throw new APIError('BAD_REQUEST', { message: 'Complete the security check and try again.' });
  let response: Response;
  try {
    response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: headers.get('cf-connecting-ip') || undefined,
      }),
    });
  } catch {
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: 'Security check unavailable. Please try again.',
    });
  }
  if (!response.ok)
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: 'Security check unavailable. Please try again.',
    });
  const result = (await response.json()) as {
    success?: boolean;
    hostname?: string;
    action?: string;
  };
  if (
    result.success !== true ||
    result.hostname !== new URL(origin).hostname ||
    result.action !== 'login'
  ) {
    throw new APIError('BAD_REQUEST', {
      message: 'Security check expired or failed. Please try again.',
    });
  }
}

export function createMailGuard(
  db: D1Database,
  verify: (headers: Headers) => Promise<void>,
  clock: () => number = Date.now,
): MailGuard {
  return {
    async acquire(email, headers) {
      try {
        // Bound challenge-verification work too. This header is supplied by Cloudflare.
        const ip = await digestKey(headers.get('cf-connecting-ip') || 'unknown');
        await consumeLimit(db, `mail-ip-minute:${ip}`, 3, 60_000, clock());
        await consumeLimit(db, `mail-ip-day:${ip}`, 15, 86_400_000, clock());
        await verify(headers);
        const recipient = await digestKey(email);
        const owner = crypto.randomUUID();
        const now = clock();
        const row = await db
          .prepare(
            'INSERT INTO auth_mail_locks (recipient,owner,expires_at) VALUES (?,?,?) ON CONFLICT(recipient) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE expires_at <= ? RETURNING owner',
          )
          .bind(recipient, owner, now + 60_000, now)
          .first();
        if (!row)
          throw new APIError('TOO_MANY_REQUESTS', {
            message: 'A code request is already in progress. Please wait.',
          });
        return async () => {
          await db
            .prepare('DELETE FROM auth_mail_locks WHERE recipient=? AND owner=?')
            .bind(recipient, owner)
            .run();
        };
      } catch (error) {
        if (error instanceof AppError)
          throw new APIError('TOO_MANY_REQUESTS', { message: error.message });
        throw error;
      }
    },
    async reserve(email) {
      const existing = await db
        .prepare('SELECT id FROM user WHERE email = ? AND emailVerified = 1')
        .bind(email)
        .first();
      await reserveEmail(db, email, clock(), !existing);
    },
  };
}
