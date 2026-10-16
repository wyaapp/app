import { env } from 'cloudflare:workers';
import { createAccountAuth } from './config';
import { sendLoginCode } from './email';

export function isStandalone() { return env.WYA_AUTH_MODE === 'email'; }
export function isAuthConfigured() { return Boolean(env.DB && env.BETTER_AUTH_SECRET && env.RESEND_API_KEY); }
export function authOrigin() { return env.WYA_ORIGIN || 'https://wya.im'; }
export function getAuth() {
  if (!env.DB || !env.BETTER_AUTH_SECRET || !env.RESEND_API_KEY) throw new Error('Account authentication is not configured.');
  const db = env.DB;
  const key = env.RESEND_API_KEY;
  return createAccountAuth(db, env.BETTER_AUTH_SECRET, authOrigin(), (email, code) => sendLoginCode(db, key, email, code));
}
