import {authSecrets} from '../scripts/auth-secrets.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {cloudflareConfig,localDatabaseId} from '../scripts/cloudflare-config.mjs';
test('production config requires real account and database identifiers',()=>{
  assert.throws(()=>cloudflareConfig({}));
  assert.throws(()=>cloudflareConfig({CLOUDFLARE_D1_DATABASE_ID:localDatabaseId,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),TURNSTILE_SITE_KEY:'0x4'+ 'a'.repeat(21)}));
  assert.throws(()=>cloudflareConfig({CLOUDFLARE_D1_DATABASE_ID:'12345678-1234-4234-8234-123456789abc',CLOUDFLARE_ACCOUNT_ID:'wrong'}));
  const config=cloudflareConfig({CLOUDFLARE_D1_DATABASE_ID:'12345678-1234-4234-8234-123456789abc',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),TURNSTILE_SITE_KEY:'0x4'+ 'a'.repeat(21)});
  assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);assert.deepEqual(config.routes,[]);
  assert.equal(config.d1_databases[0].migrations_dir,'../drizzle');
});
test('CI can build without any Cloudflare secrets',()=>{
  const config=cloudflareConfig({}, {checkOnly:true});
  assert.equal(config.d1_databases[0].database_id,localDatabaseId);assert.equal(config.account_id,undefined);
});

test('deployment refuses missing or testing Turnstile configuration',()=>{
  const base={CLOUDFLARE_D1_DATABASE_ID:'12345678-1234-4234-8234-123456789abc',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)};
  assert.throws(()=>cloudflareConfig(base),/TURNSTILE_SITE_KEY/);
  assert.throws(()=>cloudflareConfig({...base,TURNSTILE_SITE_KEY:'1x00000000000000000000AA'}),/TURNSTILE_SITE_KEY/);
});

test('release preflight rejects absent and testing secrets before any migrations',()=>{
  assert.throws(()=>authSecrets({}));
  const base={BETTER_AUTH_SECRET:'local-fixture-'.repeat(4),RESEND_API_KEY:'local-fixture'};
  assert.throws(()=>authSecrets(base));
  assert.throws(()=>authSecrets({...base,TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA'}),/testing keys/);
  assert.equal(Object.keys(authSecrets({...base,TURNSTILE_SECRET_KEY:'local-fixture-for-unit-tests'})).length,3);
});
