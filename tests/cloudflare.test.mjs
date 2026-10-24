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
  assert.throws(
    () => authSecrets({ ...base, DISCORD_FEEDBACK_WEBHOOK: 'https://example.com/private' }),
    /Discord incoming webhook/,
  );
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
});
