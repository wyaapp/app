// Isolated loopback benchmark. Never sends requests to a deployed Worker.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { Agent, request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    requests: { type: 'string', default: '1000' },
    concurrency: { type: 'string', default: '20' },
    hosts: { type: 'string', default: '100' },
    seconds: { type: 'string', default: '60' },
    port: { type: 'string', default: '8796' },
    profile: { type: 'boolean', default: false },
  },
});
function bounded(name, min, max) {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`--${name} must be an integer from ${min} to ${max}.`);
  return value;
}
const total = bounded('requests', 1, 10000);
const concurrency = bounded('concurrency', 1, 100);
const hosts = bounded('hosts', 1, 2000);
const seconds = bounded('seconds', 1, 120);
const port = bounded('port', 1024, 65535);
const builtPath = path.join(root, 'dist/server/wrangler.json');
const built = JSON.parse(await readFile(builtPath, 'utf8'));
const localId = '00000000-0000-4000-8000-000000000000';
if (
  built.d1_databases?.find((db) => db.binding === 'DB')?.database_id !== localId ||
  built.vars?.WYA_AUTH_MODE !== 'email'
)
  throw new Error(
    'First run npm run build:cloudflare -- --check. A local check build is required.',
  );
const available = createServer();
await new Promise((resolve, reject) => {
  available.once('error', reject);
  available.listen(port, '127.0.0.1', resolve);
});
await new Promise((resolve) => available.close(resolve));

const directory = await mkdtemp(path.join(tmpdir(), 'wya-domain-load-'));
const state = path.join(directory, 'state');
const configPath = path.join(directory, 'wrangler.json');
const envPath = path.join(directory, '.dev.vars');
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const agent = new Agent({ keepAlive: true, maxSockets: concurrency });
const abort = new AbortController();
const children = new Set();
const signal = () => abort.abort();
process.once('SIGINT', signal);
process.once('SIGTERM', signal);
// No deployment credentials or project dotenv files enter child processes.
const childEnv = Object.fromEntries(
  ['PATH', 'HOME', 'USER', 'TMPDIR', 'SystemRoot']
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
Object.assign(childEnv, {
  WRANGLER_SEND_METRICS: 'false',
  CLOUDFLARE_CF_FETCH_ENABLED: 'false',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  WRANGLER_REGISTRY_PATH: path.join(directory, 'registry'),
});
function launch(args) {
  const child = spawn(
    process.execPath,
    [wrangler, ...args, '--config', configPath, '--env-file', envPath],
    {
      cwd: directory,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      signal: abort.signal,
    },
  );
  children.add(child);
  let output = '';
  const capture = (chunk) => {
    output = (output + chunk).slice(-12000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(output || `Worker exited ${code}`)),
    );
  });
  done.catch(() => {});
  return { child, done, output: () => output };
}
function stop(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    /* Already stopped. */
  }
}
function get(host, pathname) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: 'GET',
        agent,
        headers: { Host: host },
        signal: abort.signal,
      },
      (response) => {
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({ status: response.statusCode, bytes, ms: performance.now() - start }),
        );
      },
    );
    req.setTimeout(10000, () => req.destroy(new Error('Local request timed out.')));
    req.on('error', reject);
    req.end();
  });
}
async function benchmark(name, pathname, count) {
  const latencies = [],
    statuses = {};
  let issued = 0,
    bytes = 0;
  const start = performance.now();
  const deadline = start + seconds * 1000;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, async () => {
      while (!abort.signal.aborted && issued < total && performance.now() < deadline) {
        const index = issued++;
        try {
          const result = await get(`load-${index % count}.example.com`, pathname);
          statuses[result.status] = (statuses[result.status] ?? 0) + 1;
          latencies.push(result.ms);
          bytes += result.bytes;
        } catch {
          statuses.error = (statuses.error ?? 0) + 1;
        }
      }
    }),
  );
  const elapsed = (performance.now() - start) / 1000;
  latencies.sort((a, b) => a - b);
  const percentile = (p) =>
    latencies.length
      ? Math.round(latencies[Math.ceil(latencies.length * p) - 1] * 100) / 100
      : null;
  console.log(
    JSON.stringify({
      scenario: name,
      path: pathname,
      hosts: count,
      requests: issued,
      concurrency,
      elapsedSeconds: +elapsed.toFixed(2),
      completedPerSecond: +(latencies.length / elapsed).toFixed(1),
      p50ms: percentile(0.5),
      p95ms: percentile(0.95),
      statuses,
      bytes,
    }),
  );
  if ((statuses[200] ?? 0) !== issued || abort.signal.aborted) process.exitCode = 1;
}
try {
  const config = {
    name: 'wya-domain-load-local',
    main: path.resolve(path.dirname(builtPath), built.main),
    compatibility_date: built.compatibility_date,
    compatibility_flags: (built.compatibility_flags ?? []).filter(
      (flag) => flag !== 'global_fetch_strictly_public',
    ),
    no_bundle: true,
    rules: built.rules,
    workers_dev: false,
    preview_urls: false,
    assets: built.assets
      ? { directory: path.resolve(path.dirname(builtPath), built.assets.directory) }
      : undefined,
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'domain-load-local',
        database_id: localId,
        migrations_dir: path.join(root, 'drizzle'),
      },
    ],
    r2_buckets: [{ binding: 'PICTURES', bucket_name: 'domain-load-local' }],
    vars: { WYA_ORIGIN: `http://127.0.0.1:${port}`, WYA_AUTH_MODE: 'email' },
    triggers: { crons: [] },
    queues: { producers: [], consumers: [] },
  };
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(envPath, '# No external credentials in local load tests.\n', { mode: 0o600 });
  await launch(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state]).done;
  const now = Date.now(),
    date = new Date(now).toISOString();
  const profile = JSON.stringify({
    name: 'Local load fixture',
    bio: 'Temporary benchmark space.',
    theme: 'lilac',
    links: [],
  });
  const sql = Array.from(
    { length: hosts },
    (_, i) => `
    INSERT INTO spaces(id,user_id,handle,data,created_at,updated_at)
    VALUES('load-${i}','load-user-${i}','load-${i}','${profile}','${date}','${date}');
    INSERT INTO space_domains(space_id,hostname,verification_token,verified_at,provider_id,
      hostname_status,ssl_status,dns_ready,checked_at,created_at)
    VALUES('load-${i}','load-${i}.example.com','local-only',${now},'load-${i}',
      'active','active',1,${now},${now});`,
  ).join('\n');
  const seed = path.join(directory, 'seed.sql');
  await writeFile(seed, sql);
  await launch(['d1', 'execute', 'DB', '--local', '--persist-to', state, '--file', seed]).done;
  const server = launch([
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--inspector-port',
    '0',
    '--persist-to',
    state,
    '--log-level',
    'error',
  ]);
  const bootDeadline = Date.now() + 45000;
  while (true) {
    if (server.child.exitCode !== null || abort.signal.aborted)
      throw new Error(server.output() || 'Worker stopped.');
    try {
      if ((await get('load-0.example.com', '/robots.txt')).status === 200) break;
    } catch {
      /* Starting. */
    }
    if (Date.now() > bootDeadline)
      throw new Error(`Local Worker did not become ready. ${server.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(
    JSON.stringify({
      scope: 'LOCAL LOOPBACK ONLY; not an edge capacity claim',
      port,
      seededDomains: hosts,
      maxRequestsPerScenario: total,
      maxSecondsPerScenario: seconds,
      providerCalls: 'Disabled; seeded active records only',
      queue: 'Disabled',
    }),
  );
  await benchmark('hot-host-warmed', '/robots.txt', 1);
  await benchmark('many-hosts-mixed-cold-warm', '/robots.txt', hosts);
  if (values.profile) await benchmark('rendered-profile', '/', hosts);
} finally {
  agent.destroy();
  for (const child of children) {
    if (child.exitCode !== null) continue;
    stop(child, 'SIGTERM');
    await Promise.race([
      once(child, 'exit').catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    if (child.exitCode === null) stop(child, 'SIGKILL');
  }
  await rm(directory, { recursive: true, force: true });
  process.removeListener('SIGINT', signal);
  process.removeListener('SIGTERM', signal);
}
