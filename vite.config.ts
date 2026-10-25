import { readFile } from 'node:fs/promises';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };
import { readExecutionProfile } from './scripts/execution-profile.mjs';
import { sites } from './build/sites-vite-plugin.ts';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;
const standalone = process.env.WYA_DEPLOY_TARGET === 'cloudflare';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';
const managedLinux = readExecutionProfile() === 'managed-linux';

const localBindingConfig = {
  main: './build/sites-worker.ts',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: [
    { binding: 'PICTURES', bucket_name: 'wya-im-pictures' },
    ...(r2
      ? [
          {
            binding: r2,
            bucket_name: 'site-creator-r2',
          },
        ]
      : []),
  ],
};

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';
  process.env.WRANGLER_SEND_METRICS ??= 'false';

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.WRANGLER_REGISTRY_PATH ??= '.wrangler/dev-registry';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    optimizeDeps: {
      // Preserve client boundaries inside Vinext's aliased navigation shims.
      exclude: ['next'],
      rolldownOptions: {
        plugins: [
          {
            name: 'simple-icons-esm',
            // Vinext's legacy CommonJS loader spends ~60s stripping comments
            // from this large, single-line ESM file. Load it unchanged before
            // that loader runs; Rolldown still bundles and tree-shakes it.
            load: {
              filter: { id: /[/\\]simple-icons[/\\]index\.mjs$/ },
              handler: (id: string) => readFile(id, 'utf8'),
            },
          },
        ],
      },
    },
    environments: {
      rsc: {
        optimizeDeps: {
          // Better Auth is excluded by the RSC plugin because it has React peers.
          // Discover its server dependencies up front, rather than replacing the
          // React dependency graph repeatedly while the first request renders.
          include: [
            '@better-auth/core/**',
            '@better-auth/utils/**',
            '@better-auth/kysely-adapter',
            '@better-auth/memory-adapter',
            '@better-auth/telemetry',
            '@better-fetch/fetch',
            '@noble/ciphers/chacha.js',
            '@noble/ciphers/utils.js',
            '@noble/hashes/hkdf.js',
            '@noble/hashes/sha2.js',
            '@noble/hashes/sha3.js',
            '@noble/hashes/utils.js',
            'better-call',
            'defu',
            'jose',
            'jose/errors',
            'kysely',
          ],
        },
      },
    },
    server: {
      host: '127.0.0.1',
      strictPort: true,
      ...(managedLinux ? { host: '0.0.0.0', allowedHosts: ['terminal.local'] } : {}),
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.sites-runtime/**'],
      },
      watch: {
        ignored: ['**/.sites-runtime/**'],
        ...(isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : {}),
      },
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux && !standalone }),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        inspectorPort: false,
        ...(standalone
          ? { configPath: './.cloudflare/wrangler.json' }
          : { config: localBindingConfig }),
      }),
    ],
  };
});
