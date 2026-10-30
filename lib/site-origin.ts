import { env } from 'cloudflare:workers';

export function publicOrigin() {
  return env.WYA_ORIGIN || 'https://wya.im';
}
export function appOrigin() {
  return env.WYA_APP_ORIGIN || publicOrigin();
}
