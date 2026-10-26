# Local custom-domain load check

This benchmark measures the built Worker over loopback HTTP. Its timings include local workerd, local D1, the load generator and this machine's scheduling. They are not Cloudflare edge capacity, production database latency or a supported concurrent-user limit.

Build and run from the repository:

```sh
npm run build:cloudflare -- --check
node scripts/load-custom-domains.mjs --requests 1000 --concurrency 20 --hosts 100 --profile
```

The harness refuses a build with a non-local database ID or without the standalone Cloudflare configuration. It creates a temporary Wrangler configuration and isolated D1/R2 state, applies the repository migrations locally, seeds temporary active domains, then starts the built Worker at `127.0.0.1:8796`. An occupied port causes it to stop. No existing development database is used.

All requests connect directly to loopback; the generated `load-N.example.com` names appear only in the HTTP Host header. The harness never looks up their DNS, contacts the domain provider, provisions hostnames or exercises a real account. It excludes project environment files and deployment credentials from child processes. Queues and scheduled events are disabled. Temporary files and child processes are cleaned up when the run finishes or is interrupted.

## Scenarios and output

Each scenario emits one JSON object with request count, HTTP status counts, completed requests per second, p50/p95 response latency and response bytes:

1. `hot-host-warmed`: `/robots.txt` on the hostname used by the readiness probe. Exercises the custom-domain routing path with a warm lookup cache, without page rendering.
2. `many-hosts-mixed-cold-warm`: `/robots.txt` rotating across the seeded hostnames. Includes initial cache misses and subsequent hits when the working set fits the cache. For a working set larger than the cache, this also exercises eviction.
3. `rendered-profile`, enabled by `--profile`: `/` rotating across minimal public profiles. Adds the real page rendering and public profile database queries, without loading browser assets or executing client JavaScript.

Non-200 responses and transport errors produce a nonzero exit status. Inspect the status counts before interpreting throughput. The harness does not expose internal cache-hit or D1 query counters; cache effectiveness is additionally covered by the deterministic cache unit tests.

## Bounds

| Argument | Default | Allowed range |
| --- | --- | --- |
| `--requests` | 1000 per scenario | 1-10000 |
| `--concurrency` | 20 | 1-100 |
| `--hosts` | 100 | 1-2000 |
| `--seconds` | 60 per scenario | 1-120 |
| `--port` | 8796 | 1024-65535, loopback only |

A scenario stops issuing requests at its request count or time limit, whichever comes first. Outstanding requests can take up to the ten-second socket timeout to finish. There is no remote target option. For repeatable comparisons, use the same build type, arguments, machine and background workload, and repeat runs rather than treating one result as a capacity guarantee.

The separate maintenance tests cover queue scheduling, retries and freshness. This HTTP benchmark intentionally does not produce provider or DNS traffic. Production load testing requires its own scope and approval.

## Local validation on October 26, 2026

One check-build run used 1,000 requests per scenario, concurrency 20 and 100 seeded hosts. All 3,000 requests returned HTTP 200.

| Scenario | Completed requests/second | p95 latency |
| --- | ---: | ---: |
| Warm hostname, routing only | 978.9 | 40.43ms |
| Mixed cold/warm hostnames, routing only | 1,155.1 | 33.34ms |
| Rendered public profiles | 145.7 | 201.28ms |

These are a local functional/load sanity check on the development machine. They do not measure edge execution, network distance, production D1 contention or browser rendering, and they do not establish production capacity. The mixed-host result being faster than the warm-host run also illustrates why a single sequential run should not be used to rank cache performance.
