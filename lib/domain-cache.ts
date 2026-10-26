import type { DomainRow } from './custom-domains.ts';
import type { HostingMode } from './plans.ts';

export type DomainRoutingRow = DomainRow & { handle: string };
type Lookup = (hostname: string) => Promise<DomainRoutingRow | null>;
type Expiration = (row: DomainRoutingRow, now: number) => number;

export const DOMAIN_LOOKUP_TTL = 15_000;
export const DOMAIN_LOOKUP_NEGATIVE_TTL = 1_000;
const DEFAULT_CAPACITY = 1024;
const DEFAULT_PENDING_CAPACITY = 64;

/** Isolate-local only. Other isolates observe changes within the bounded TTL. */
export function createDomainLookupCache(
  load: Lookup,
  expiresAt: Expiration,
  options: { now?: () => number; capacity?: number; pendingCapacity?: number } = {},
) {
  const now = options.now ?? Date.now;
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const pendingCapacity = options.pendingCapacity ?? DEFAULT_PENDING_CAPACITY;
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error('Domain cache capacity must be a positive integer.');
  if (!Number.isInteger(pendingCapacity) || pendingCapacity < 1)
    throw new Error('Domain cache pending capacity must be a positive integer.');
  const entries = new Map<string, { value: DomainRoutingRow | null; until: number }>();
  const pending = new Map<
    string,
    { promise: Promise<DomainRoutingRow | null>; invalidated: boolean }
  >();
  const counts = { hits: 0, misses: 0, loads: 0, coalesced: 0 };
  const copy = (row: DomainRoutingRow | null) => (row ? { ...row } : null);

  async function lookup(hostname: string): Promise<DomainRoutingRow | null> {
    const current = now();
    const cached = entries.get(hostname);
    if (cached && cached.until > current) {
      counts.hits++;
      // Refresh LRU position, never the expiry time.
      entries.delete(hostname);
      entries.set(hostname, cached);
      return copy(cached.value);
    }
    entries.delete(hostname);
    const loading = pending.get(hostname);
    if (loading) {
      counts.coalesced++;
      return copy(await loading.promise);
    }
    counts.misses++;
    counts.loads++;
    // Random unknown hostnames must not retain an unbounded set of promises.
    // Overflow reads bypass the cache, including writes when they resolve.
    if (pending.size >= pendingCapacity) return copy(await load(hostname));
    const token = { promise: null! as Promise<DomainRoutingRow | null>, invalidated: false };
    pending.set(hostname, token);
    token.promise = (async () => {
      try {
        const value = copy(await load(hostname));
        // A mutation raced with the read. All waiters must use a fresh lookup;
        // the old result must not become a new cache entry or escape to a waiter.
        if (token.invalidated) return lookup(hostname);
        const completed = now();
        // Count from the read's start so slow reads cannot extend revocation lag.
        const until = value
          ? Math.min(current + DOMAIN_LOOKUP_TTL, expiresAt(value, current))
          : current + DOMAIN_LOOKUP_NEGATIVE_TTL;
        if (Number.isFinite(until) && until > completed) {
          while (entries.size >= capacity) entries.delete(entries.keys().next().value!);
          entries.set(hostname, { value, until });
        }
        return value;
      } finally {
        if (pending.get(hostname) === token) pending.delete(hostname);
      }
    })();
    return copy(await token.promise);
  }

  function invalidate(hostname: string) {
    entries.delete(hostname);
    const loading = pending.get(hostname);
    if (loading) loading.invalidated = true;
    pending.delete(hostname);
  }

  return {
    lookup,
    invalidate,
    stats: () => ({ ...counts, entries: entries.size, pending: pending.size }),
  };
}

const caches = new WeakMap<
  D1Database,
  Map<HostingMode, ReturnType<typeof createDomainLookupCache>>
>();

/** Keep state per binding identity, including between service factory calls. */
export function cachedDomainLookup(
  db: D1Database,
  load: Lookup,
  expiresAt: Expiration,
  hostingMode: HostingMode = 'self-hosted',
): Lookup {
  let partitions = caches.get(db);
  if (!partitions) {
    partitions = new Map();
    caches.set(db, partitions);
  }
  let cache = partitions.get(hostingMode);
  if (!cache) {
    cache = createDomainLookupCache(load, expiresAt);
    partitions.set(hostingMode, cache);
  }
  return cache.lookup;
}

/** Call before and after a routing mutation; no global purge is claimed. */
export function invalidateDomainLookup(db: D1Database, hostname: string) {
  for (const cache of caches.get(db)?.values() ?? []) cache.invalidate(hostname);
}
