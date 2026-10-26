import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const localDatabaseId = '00000000-0000-4000-8000-000000000000';
export function cloudflareConfig(environment, { checkOnly = false } = {}) {
  const hostingMode = checkOnly ? 'self-hosted' : environment.WYA_HOSTING_MODE || 'self-hosted';
  if (!['hosted', 'self-hosted'].includes(hostingMode))
    throw new Error('WYA_HOSTING_MODE must be hosted or self-hosted.');
  const stripePrices = checkOnly
    ? {}
    : Object.fromEntries(
        ['STRIPE_PRICE_USD_MONTHLY', 'STRIPE_PRICE_BRL_MONTHLY']
          .filter((name) => environment[name])
          .map((name) => [name, environment[name]]),
      );
  if (
    Object.keys(stripePrices).length &&
    (hostingMode !== 'hosted' ||
      Object.keys(stripePrices).length !== 2 ||
      Object.values(stripePrices).some((price) => !/^price_[A-Za-z0-9]+$/.test(price)) ||
      new Set(Object.values(stripePrices)).size !== 2)
  )
    throw new Error(
      'Hosted billing requires two distinct Stripe Price IDs for USD/BRL monthly subscriptions.',
    );
  const domainZone = checkOnly ? undefined : environment.CUSTOM_DOMAINS_ZONE_ID;
  const domainTarget = checkOnly ? undefined : environment.CUSTOM_DOMAINS_TARGET;
  if (
    (domainZone || domainTarget) &&
    (!/^[a-f0-9]{32}$/i.test(domainZone ?? '') ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domainTarget ?? ''))
  )
    throw new Error(
      'Set both CUSTOM_DOMAINS_ZONE_ID and CUSTOM_DOMAINS_TARGET to enable custom domains.',
    );
  const databaseId = checkOnly ? localDatabaseId : environment.CLOUDFLARE_D1_DATABASE_ID;
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID;
  if (
    !databaseId ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(databaseId) ||
    (!checkOnly && databaseId === localDatabaseId)
  ) {
    throw new Error('Set CLOUDFLARE_D1_DATABASE_ID to the UUID of the deployment database.');
  }
  if (!checkOnly && (!accountId || !/^[0-9a-f]{32}$/i.test(accountId))) {
    throw new Error('Set CLOUDFLARE_ACCOUNT_ID to the target account ID.');
  }
  const siteKey = checkOnly ? '1x00000000000000000000AA' : environment.TURNSTILE_SITE_KEY;
  if (!checkOnly && environment.POSTHOG_PROJECT_ID && !/^\d+$/.test(environment.POSTHOG_PROJECT_ID))
    throw new Error('POSTHOG_PROJECT_ID must be numeric.');
  const analytics = checkOnly
    ? {}
    : { token: environment.POSTHOG_PROJECT_TOKEN, host: environment.POSTHOG_HOST };
  if (
    (analytics.token || analytics.host) &&
    (!/^phc_[A-Za-z0-9_-]+$/.test(analytics.token ?? '') ||
      !['https://eu.i.posthog.com', 'https://us.i.posthog.com'].includes(analytics.host))
  ) {
    throw new Error(
      'Set both POSTHOG_PROJECT_TOKEN (public phc_ token) and POSTHOG_HOST (EU or US ingestion URL), or omit both.',
    );
  }
  if (
    !siteKey ||
    (!checkOnly && (!/^[A-Za-z0-9_-]{20,64}$/.test(siteKey) || /^[123]x0{10}/.test(siteKey)))
  )
    throw new Error('Set TURNSTILE_SITE_KEY to the production widget site key.');
  return {
    $schema: '../node_modules/wrangler/config-schema.json',
    name: 'wya-im',
    main: '../deployment/worker.ts',
    compatibility_date: '2026-05-15',
    // OAuth token verification fetches this Worker's public /api/auth/jwks.
    // Route same-zone fetches through Cloudflare, not to an origin server.
    compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
    ...(checkOnly ? {} : { account_id: accountId }),
    // Domain attachment is managed in the Cloudflare dashboard. Empty routes
    // leave existing custom domains untouched; CI needs no DNS permissions.
    workers_dev: false,
    preview_urls: false,
    routes: [],
    vars: {
      WYA_AUTH_MODE: 'email',
      WYA_HOSTING_MODE: hostingMode,
      WYA_ORIGIN: 'https://wya.im',
      ...stripePrices,
      ...(domainZone
        ? { CUSTOM_DOMAINS_ZONE_ID: domainZone, CUSTOM_DOMAINS_TARGET: domainTarget }
        : {}),
      TURNSTILE_SITE_KEY: siteKey,
      ...(!checkOnly && environment.GIPHY_API_KEY?.trim()
        ? { GIPHY_API_KEY: environment.GIPHY_API_KEY.trim() }
        : {}),
      ...(analytics.token
        ? {
            POSTHOG_PROJECT_TOKEN: analytics.token,
            POSTHOG_HOST: analytics.host,
            ...(environment.POSTHOG_PROJECT_ID
              ? { POSTHOG_PROJECT_ID: environment.POSTHOG_PROJECT_ID }
              : {}),
          }
        : {}),
    },
    observability: { enabled: true },
    r2_buckets: [{ binding: 'PICTURES', bucket_name: 'wya-im-pictures' }],
    // Provision these queues explicitly before deploying. Keeping names stable
    // lets the existing Worker consume jobs across configuration-only releases.
    ...(domainZone || checkOnly
      ? {
          queues: {
            producers: [{ binding: 'DOMAIN_MAINTENANCE', queue: 'wya-domain-maintenance' }],
            consumers: [
              {
                queue: 'wya-domain-maintenance',
                max_batch_size: 3,
                max_batch_timeout: 5,
                max_retries: 5,
                retry_delay: 60,
                max_concurrency: 2,
                dead_letter_queue: 'wya-domain-maintenance-dead',
              },
            ],
          },
        }
      : {}),
    triggers: { crons: domainZone || checkOnly ? ['17 * * * *', '*/5 * * * *'] : ['17 * * * *'] },
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'wya-im',
        database_id: databaseId,
        migrations_dir: '../drizzle',
      },
    ],
  };
}
export async function writeCloudflareConfig(options = {}) {
  const config = cloudflareConfig(process.env, options);
  const directory = fileURLToPath(new URL('../.cloudflare/', import.meta.url));
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'wrangler.json');
  await writeFile(file, JSON.stringify(config, null, 2) + '\n');
  return file;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeCloudflareConfig({ checkOnly: process.argv.includes('--check') });
  console.log('Cloudflare configuration prepared.');
}
