import { authSecrets } from '../scripts/auth-secrets.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudflareConfig, localDatabaseId } from '../scripts/cloudflare-config.mjs';
test('production config requires real account and database identifiers', () => {
  assert.throws(() => cloudflareConfig({}));
  assert.throws(() =>
    cloudflareConfig({
      CLOUDFLARE_D1_DATABASE_ID: localDatabaseId,
      CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
      TURNSTILE_SITE_KEY: '0x4' + 'a'.repeat(21),
    }),
  );
  assert.throws(() =>
    cloudflareConfig({
      CLOUDFLARE_D1_DATABASE_ID: '12345678-1234-4234-8234-123456789abc',
      CLOUDFLARE_ACCOUNT_ID: 'wrong',
    }),
  );
  const config = cloudflareConfig({
    CLOUDFLARE_D1_DATABASE_ID: '12345678-1234-4234-8234-123456789abc',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    TURNSTILE_SITE_KEY: '0x4' + 'a'.repeat(21),
  });
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.equal(config.d1_databases[0].migrations_dir, '../drizzle');
});
test('CI can build without any Cloudflare secrets', () => {
  const config = cloudflareConfig({}, { checkOnly: true });
  assert.equal(config.d1_databases[0].database_id, localDatabaseId);
  assert.equal(config.account_id, undefined);
});

test('self-hosting is free by default and hosted billing exposes only configured price IDs', () => {
  const base = {
    CLOUDFLARE_D1_DATABASE_ID: '12345678-1234-4234-8234-123456789abc',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    TURNSTILE_SITE_KEY: '0x4' + 'a'.repeat(21),
  };
  assert.equal(cloudflareConfig(base).vars.WYA_HOSTING_MODE, 'self-hosted');
  assert.throws(() => cloudflareConfig({ ...base, WYA_HOSTING_MODE: 'typo' }), /WYA_HOSTING_MODE/);
  const paid = {
    ...base,
    WYA_HOSTING_MODE: 'hosted',
    STRIPE_PRICE_USD_MONTHLY: 'price_usdmonth',
    STRIPE_PRICE_BRL_MONTHLY: 'price_brlmonth',
    STRIPE_SECRET_KEY: 'not-for-client',
    STRIPE_WEBHOOK_SECRET: 'not-for-client',
  };
  const config = cloudflareConfig(paid);
  assert.equal(config.vars.STRIPE_PRICE_BRL_MONTHLY, 'price_brlmonth');
  assert.equal(config.vars.STRIPE_SECRET_KEY, undefined);
  assert.equal(config.vars.STRIPE_WEBHOOK_SECRET, undefined);
  assert.equal(
    cloudflareConfig(paid, { checkOnly: true }).vars.STRIPE_PRICE_USD_MONTHLY,
    undefined,
  );
  assert.throws(() => cloudflareConfig({ ...paid, STRIPE_PRICE_USD_MONTHLY: '' }), /two distinct/);
  assert.throws(
    () => cloudflareConfig({ ...paid, WYA_HOSTING_MODE: 'self-hosted' }),
    /Hosted billing/,
  );
});

test('production billing refuses partial setup and test credentials before deployment', () => {
  const base = {
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    RESEND_API_KEY: 'fixture',
    TURNSTILE_SECRET_KEY: 'local-fixture-for-unit-tests',
    WYA_HOSTING_MODE: 'hosted',
    STRIPE_PRICE_USD_MONTHLY: 'price_usdmonth',
    STRIPE_PRICE_BRL_MONTHLY: 'price_brlmonth',
    STRIPE_SECRET_KEY: 'sk_live_unitfixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_unitfixture',
  };
  assert.equal(authSecrets(base).STRIPE_SECRET_KEY, base.STRIPE_SECRET_KEY);
  assert.equal(authSecrets(base).STRIPE_PRICE_USD_MONTHLY, undefined);
  assert.throws(() => authSecrets({ ...base, STRIPE_WEBHOOK_SECRET: '' }), /together/);
  assert.throws(() => authSecrets({ ...base, STRIPE_PRICE_BRL_MONTHLY: '' }), /together/);
  assert.throws(
    () => authSecrets({ ...base, STRIPE_SECRET_KEY: 'sk_test_fixture' }),
    /live Stripe/,
  );
  assert.throws(() => authSecrets({ ...base, WYA_HOSTING_MODE: 'self-hosted' }), /hosted mode/);
});

test('PostHog configuration is optional and only accepts public tokens and known ingestion hosts', () => {
  const base = {
    CLOUDFLARE_D1_DATABASE_ID: '12345678-1234-4234-8234-123456789abc',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    TURNSTILE_SITE_KEY: '0x4' + 'a'.repeat(21),
  };
  assert.equal(cloudflareConfig(base).vars.POSTHOG_PROJECT_TOKEN, undefined);
  assert.throws(() => cloudflareConfig({ ...base, POSTHOG_PROJECT_TOKEN: 'phc_test' }), /POSTHOG/);
  assert.throws(
    () =>
      cloudflareConfig({
        ...base,
        POSTHOG_PROJECT_TOKEN: 'phx_private',
        POSTHOG_HOST: 'https://eu.i.posthog.com',
      }),
    /POSTHOG/,
  );
  assert.throws(
    () =>
      cloudflareConfig({
        ...base,
        POSTHOG_PROJECT_TOKEN: 'phc_test',
        POSTHOG_HOST: 'https://untrusted.example',
      }),
    /POSTHOG/,
  );
  const configured = {
    ...base,
    POSTHOG_PROJECT_TOKEN: 'phc_test',
    POSTHOG_HOST: 'https://eu.i.posthog.com',
  };
  assert.equal(cloudflareConfig(configured).vars.POSTHOG_HOST, configured.POSTHOG_HOST);
  assert.equal(
    cloudflareConfig(configured, { checkOnly: true }).vars.POSTHOG_PROJECT_TOKEN,
    undefined,
  );
});

test('GIPHY browser configuration is optional and excluded from check builds', () => {
  const base = {
    CLOUDFLARE_D1_DATABASE_ID: '12345678-1234-4234-8234-123456789abc',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    TURNSTILE_SITE_KEY: '0x4' + 'a'.repeat(21),
  };
  assert.equal(cloudflareConfig(base).vars.GIPHY_API_KEY, undefined);
  const configured = { ...base, GIPHY_API_KEY: ' public-browser-test-key ' };
  assert.equal(cloudflareConfig(configured).vars.GIPHY_API_KEY, 'public-browser-test-key');
  assert.equal(cloudflareConfig(configured, { checkOnly: true }).vars.GIPHY_API_KEY, undefined);
});

test('deployment refuses missing or testing Turnstile configuration', () => {
  const base = {
    CLOUDFLARE_D1_DATABASE_ID: '12345678-1234-4234-8234-123456789abc',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  };
  assert.throws(() => cloudflareConfig(base), /TURNSTILE_SITE_KEY/);
  assert.throws(
    () => cloudflareConfig({ ...base, TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }),
    /TURNSTILE_SITE_KEY/,
  );
});

test('release preflight rejects absent and testing secrets before any migrations', () => {
  assert.throws(() => authSecrets({}));
  const base = { BETTER_AUTH_SECRET: 'local-fixture-'.repeat(4), RESEND_API_KEY: 'local-fixture' };
  assert.throws(() => authSecrets(base));
  assert.throws(
    () => authSecrets({ ...base, TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' }),
    /testing keys/,
  );
  assert.equal(
    Object.keys(authSecrets({ ...base, TURNSTILE_SECRET_KEY: 'local-fixture-for-unit-tests' }))
      .length,
    3,
  );
});

test('game catalog secrets are optional but must be supplied together', () => {
  const base = {
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    RESEND_API_KEY: 'local-test',
    TURNSTILE_SECRET_KEY: 'local-fixture-for-unit-tests',
  };
  assert.throws(() => authSecrets({ ...base, IGDB_CLIENT_ID: 'client' }), /both IGDB/);
  const result = authSecrets({ ...base, IGDB_CLIENT_ID: 'client', IGDB_CLIENT_SECRET: 'private' });
  assert.equal(result.IGDB_CLIENT_ID, 'client');
  assert.equal(result.IGDB_CLIENT_SECRET, 'private');
});

test('metrics query key is server-only and rejects the public ingestion token', () => {
  const base = {
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    RESEND_API_KEY: 'local-test',
    TURNSTILE_SECRET_KEY: 'local-fixture-for-unit-tests',
  };
  assert.throws(() => authSecrets({ ...base, POSTHOG_READ_KEY: 'phc_public' }), /server-only/);
  assert.equal(authSecrets({ ...base, POSTHOG_READ_KEY: 'phx_test' }).POSTHOG_READ_KEY, 'phx_test');
});

test('feedback webhook is optional and synchronized only as a Worker secret', () => {
  const base = {
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    RESEND_API_KEY: 'local-test',
    TURNSTILE_SECRET_KEY: 'local-fixture-for-unit-tests',
  };
  assert.equal(authSecrets(base).DISCORD_FEEDBACK_WEBHOOK, undefined);
  const webhook = 'https://discord.com/api/webhooks/123/test-token';
  assert.equal(
    authSecrets({ ...base, DISCORD_FEEDBACK_WEBHOOK: webhook }).DISCORD_FEEDBACK_WEBHOOK,
    webhook,
  );
  for (const value of [
    'http://discord.com/api/webhooks/123/token',
    'https://example.com/private',
    `${webhook}?redirect=1`,
    `${webhook}\n`,
  ]) {
    assert.throws(
      () => authSecrets({ ...base, DISCORD_FEEDBACK_WEBHOOK: value }),
      /DISCORD_FEEDBACK_WEBHOOK must be a Discord incoming webhook URL/,
    );
  }
});

test('retired contact webhook is never synchronized or included in Worker configuration', () => {
  const base = {
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    RESEND_API_KEY: 'local-test',
    TURNSTILE_SECRET_KEY: 'local-fixture-for-unit-tests',
  };
  assert.equal(authSecrets(base).DISCORD_CONTACT_WEBHOOK, undefined);
  const contact = 'https://discord.com/api/webhooks/456/contact-test-token';
  const feedback = 'https://discord.com/api/webhooks/123/feedback-test-token';
  const result = authSecrets({
    ...base,
    DISCORD_CONTACT_WEBHOOK: contact,
    DISCORD_FEEDBACK_WEBHOOK: feedback,
  });
  assert.equal(result.DISCORD_CONTACT_WEBHOOK, undefined);
  assert.equal(result.DISCORD_FEEDBACK_WEBHOOK, feedback);
  assert.ok(!JSON.stringify(result).includes(contact));
  const generated = cloudflareConfig({ DISCORD_CONTACT_WEBHOOK: contact }, { checkOnly: true });
  assert.ok(!JSON.stringify(generated).includes(contact));
  assert.equal(generated.vars.DISCORD_CONTACT_WEBHOOK, undefined);
});

test('custom-domain activation is optional and the API token is synchronized only as a secret', () => {
  const base = {
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    RESEND_API_KEY: 'local-test',
    TURNSTILE_SECRET_KEY: 'local-test',
    CLOUDFLARE_D1_DATABASE_ID: '12345678-1234-4234-8234-123456789abc',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    TURNSTILE_SITE_KEY: '0x4' + 'a'.repeat(21),
  };
  assert.equal(authSecrets(base).CUSTOM_DOMAINS_API_TOKEN, undefined);
  assert.throws(() => authSecrets({ ...base, CUSTOM_DOMAINS_ZONE_ID: 'a'.repeat(32) }), /together/);
  const configured = {
    ...base,
    CUSTOM_DOMAINS_ZONE_ID: 'b'.repeat(32),
    CUSTOM_DOMAINS_TARGET: 'domains.wya.im',
    CUSTOM_DOMAINS_API_TOKEN: 'local-test-only',
  };
  assert.equal(authSecrets(configured).CUSTOM_DOMAINS_API_TOKEN, 'local-test-only');
  const vars = cloudflareConfig(configured).vars;
  assert.equal(vars.CUSTOM_DOMAINS_TARGET, 'domains.wya.im');
  assert.equal(vars.CUSTOM_DOMAINS_API_TOKEN, undefined);
  assert.equal(
    cloudflareConfig(configured, { checkOnly: true }).vars.CUSTOM_DOMAINS_ZONE_ID,
    undefined,
  );
  const release = cloudflareConfig(configured);
  assert.deepEqual(release.triggers.crons, ['17 * * * *', '*/5 * * * *']);
  assert.deepEqual(release.queues.producers, [
    { binding: 'DOMAIN_MAINTENANCE', queue: 'wya-domain-maintenance' },
  ]);
  assert.equal(release.queues.consumers[0].queue, release.queues.producers[0].queue);
  assert.equal(release.queues.consumers[0].max_batch_size, 3);
  assert.equal(release.queues.consumers[0].max_concurrency, 2);
  assert.equal(release.queues.consumers[0].dead_letter_queue, 'wya-domain-maintenance-dead');
  assert.equal(cloudflareConfig(base).queues, undefined);
  assert.ok(
    cloudflareConfig({}, { checkOnly: true }).queues,
    'check builds validate queue bindings',
  );
});
