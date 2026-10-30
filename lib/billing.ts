import { env } from 'cloudflare:workers';
import { createBillingService } from './billing-service';
import { resolveHostingMode } from './plans';

export function billing() {
  if (!env.DB) throw new Error('Database is not configured.');
  return createBillingService(env.DB, {
    hostingMode: resolveHostingMode(env.WYA_HOSTING_MODE),
    origin: env.WYA_APP_ORIGIN || env.WYA_ORIGIN || 'https://wya.im',
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    prices: {
      usd: { month: env.STRIPE_PRICE_USD_MONTHLY },
      brl: { month: env.STRIPE_PRICE_BRL_MONTHLY },
    },
  });
}
