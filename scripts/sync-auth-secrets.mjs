import { authSecrets } from './auth-secrets.mjs';
// Called by CI after migrations. Secrets flow through stdin, never command args or logs.
import { spawnSync } from 'node:child_process';
const secrets = authSecrets(process.env);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'secret',
    'bulk',
    '--config',
    '.cloudflare/wrangler.json',
  ],
  { input: JSON.stringify(secrets), stdio: ['pipe', 'inherit', 'inherit'], env: process.env },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
