import { appOrigin, publicOrigin } from '../site-origin';
import { createMailGuard, verifyTurnstile } from './mail-guard';
import { env } from 'cloudflare:workers';
import { createAccountAuth } from './config';
import { sendLoginCode } from './email';

export function isStandalone() {
  return env.WYA_AUTH_MODE === 'email';
}
export function isAuthConfigured() {
  return Boolean(env.DB && env.BETTER_AUTH_SECRET && env.RESEND_API_KEY);
}
export const authOrigin = publicOrigin;
export function getAuth(requestOrigin = authOrigin()) {
  if (![authOrigin(), appOrigin()].includes(requestOrigin))
    throw new Error('Untrusted authentication origin.');
  if (!env.DB || !env.BETTER_AUTH_SECRET || !env.RESEND_API_KEY)
    throw new Error('Account authentication is not configured.');
  const db = env.DB;
  const key = env.RESEND_API_KEY;
  return createAccountAuth(
    db,
    env.BETTER_AUTH_SECRET,
    requestOrigin,
    (email, code) => sendLoginCode(key, email, code),
    createMailGuard(db, (headers) =>
      verifyTurnstile(env.TURNSTILE_SECRET_KEY, requestOrigin, headers),
    ),
  );
}
