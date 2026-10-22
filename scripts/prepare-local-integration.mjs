// Prepare an ignored loopback-only config; never modify the production build config.
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
if (config.d1_databases?.[0]?.database_id !== '00000000-0000-4000-8000-000000000000')
  throw new Error('Build with --check before local integration testing.');
const vars = parseEnv(await readFile('.dev.vars', 'utf8'));
if (vars.WYA_ORIGIN !== 'http://127.0.0.1:8787')
  throw new Error('Local tests require WYA_ORIGIN=http://127.0.0.1:8787.');
config.compatibility_flags = config.compatibility_flags.filter(
  (flag) => flag !== 'global_fetch_strictly_public',
);
await writeFile('dist/server/wrangler.integration.json', JSON.stringify(config, null, 2));
for (const target of ['dist/server/.dev.vars', '.cloudflare/.dev.vars']) {
  // Domain integration tests use local fixtures, never real provider credentials.
  const localVariables = {
    ...vars,
    CUSTOM_DOMAINS_ZONE_ID: 'a'.repeat(32),
    CUSTOM_DOMAINS_TARGET: 'domains.wya.im',
    CUSTOM_DOMAINS_API_TOKEN: 'local-test-not-a-real-token',
  };
  await writeFile(
    target,
    Object.entries(localVariables)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n',
  );
  await chmod(target, 0o600);
}
console.log('Local-only Worker config prepared; production self-fetch settings are unchanged.');
