import { spawnSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { writeCloudflareConfig } from './cloudflare-config.mjs';
await writeCloudflareConfig({ checkOnly: process.argv.includes('--check') });
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('./run-framework.mjs', import.meta.url)), 'build'],
  {
    stdio: 'inherit',
    env: { ...process.env, WYA_DEPLOY_TARGET: 'cloudflare' },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const dashboard = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
    'build',
    '--config',
    'dashboard.vite.config.ts',
  ],
  { stdio: 'inherit' },
);
if (dashboard.error) throw dashboard.error;
if (dashboard.status !== 0) process.exit(dashboard.status ?? 1);
await mkdir('dist/client/_app', { recursive: true });
await cp('dist/dashboard/_app', 'dist/client/_app', { recursive: true });
await cp('dist/dashboard/index.html', 'dist/client/_app/index.html');
