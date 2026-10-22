import { AppError } from './app-error.ts';
import { consumeLimit, digestKey, limitMutation } from './abuse-limits.ts';
import {
  domainStatus,
  normalizeCustomDomain,
  type DomainRow,
  type DomainSettings,
} from './custom-domains.ts';
import {
  createDomainProvider,
  domainsConfigured,
  providerRecords,
  verifyDomainTxt,
  verifyDomainRouting,
  type DomainConfig,
  type DomainProvider,
} from './domain-provider.ts';

export function createDomainService(
  db: D1Database,
  config: DomainConfig,
  dependencies: {
    provider?: DomainProvider;
    verifyTxt?: typeof verifyDomainTxt;
    verifyRouting?: typeof verifyDomainRouting;
    now?: () => number;
  } = {},
) {
  const provider = dependencies.provider ?? createDomainProvider(config);
  const verifyTxt = dependencies.verifyTxt ?? verifyDomainTxt;
  const verifyRouting = dependencies.verifyRouting ?? verifyDomainRouting;
  const now = dependencies.now ?? Date.now;
  const read = (spaceId: string) =>
    db.prepare('SELECT * FROM space_domains WHERE space_id = ?').bind(spaceId).first<DomainRow>();
  async function owned(userId: string, spaceId: string) {
    const owner = await db
      .prepare('SELECT id FROM spaces WHERE id = ? AND user_id = ?')
      .bind(spaceId, userId)
      .first();
    if (!owner) throw new AppError('Space not found.', 404);
  }
  async function settings(spaceId: string): Promise<DomainSettings> {
    const row = await read(spaceId);
    return {
      available: domainsConfigured(config),
      target: config.target ?? null,
      domain: row ? domainStatus(row, now()) : null,
    };
  }
  async function get(userId: string, spaceId: string) {
    await owned(userId, spaceId);
    return settings(spaceId);
  }
  async function locked(spaceId: string, callback: (row: DomainRow) => Promise<void>) {
    const lock = crypto.randomUUID();
    const row = await db
      .prepare(
        'UPDATE space_domains SET lock_id = ?, lock_until = ? WHERE space_id = ? AND lock_until < ? RETURNING *',
      )
      .bind(lock, now() + 90_000, spaceId, now())
      .first<DomainRow>();
    if (!row)
      throw new AppError('A domain update is already running. Please try again shortly.', 409);
    try {
      await callback(row);
    } finally {
      await db
        .prepare(
          'UPDATE space_domains SET lock_id = NULL, lock_until = 0 WHERE space_id = ? AND lock_id = ?',
        )
        .bind(spaceId, lock)
        .run();
    }
  }
  async function remove(row: DomainRow) {
    // Stop serving/redirecting first. Keep the record to retry failed provider cleanup.
    await db
      .prepare('UPDATE space_domains SET removing = 1, redirect = 0 WHERE space_id = ?')
      .bind(row.space_id)
      .run();
    let id = row.provider_id;
    // A verified row without an ID may be a registration interrupted before its D1 save.
    if (!id && row.verified_at !== null) id = (await provider.find(row.hostname))?.id ?? null;
    if (id) await provider.remove(id);
    await db.prepare('DELETE FROM space_domains WHERE space_id = ?').bind(row.space_id).run();
  }
  async function refresh(row: DomainRow) {
    await db
      .prepare('UPDATE space_domains SET attempted_at = ? WHERE space_id = ?')
      .bind(now(), row.space_id)
      .run();
    if (row.removing) return remove(row);
    // Retain the TXT record to keep demonstrating control if a domain changes owners.
    if (!(await verifyTxt(row.hostname, row.verification_token))) {
      await db
        .prepare(
          "UPDATE space_domains SET hostname_status = 'unverified', dns_ready = 0, checked_at = ? WHERE space_id = ?",
        )
        .bind(now(), row.space_id)
        .run();
      return;
    }
    if (row.verified_at === null) {
      try {
        await db
          .prepare('UPDATE space_domains SET verified_at = ? WHERE space_id = ?')
          .bind(now(), row.space_id)
          .run();
      } catch (error) {
        if (String(error).includes('UNIQUE'))
          throw new AppError('This domain is already connected to another space.', 409);
        throw error;
      }
    }
    let host;
    try {
      host = row.provider_id
        ? await provider.get(row.provider_id)
        : await provider.ensure(row.hostname);
    } catch (error) {
      if (error instanceof AppError && error.status === 409)
        await db
          .prepare("UPDATE space_domains SET hostname_status = 'unavailable' WHERE space_id = ?")
          .bind(row.space_id)
          .run();
      throw error;
    }
    if (host.hostname !== row.hostname || !host.id)
      throw new AppError('Could not verify the domain registration.', 503);
    const dnsReady =
      host.status === 'active' &&
      host.ssl?.status === 'active' &&
      (await verifyRouting(row.hostname, config.target!));
    await db
      .prepare(
        'UPDATE space_domains SET provider_id = ?, hostname_status = ?, ssl_status = ?, dns_ready = ?, records = ?, checked_at = ? WHERE space_id = ?',
      )
      .bind(
        host.id,
        host.status ?? 'pending',
        host.ssl?.status ?? 'pending',
        dnsReady ? 1 : 0,
        JSON.stringify(providerRecords(host)),
        now(),
        row.space_id,
      )
      .run();
  }
  async function change(
    userId: string,
    spaceId: string,
    input: { action: string; hostname?: string; redirect?: boolean },
  ) {
    await owned(userId, spaceId);
    if (!domainsConfigured(config))
      throw new AppError('Custom domains are not available yet.', 503);
    await limitMutation(db, userId, now());
    if (input.action === 'connect') {
      await consumeLimit(db, `domain-connect:${await digestKey(userId)}`, 10, 86_400_000, now());
      const hostname = normalizeCustomDomain(input.hostname ?? '', [
        new URL(config.origin ?? 'https://wya.im').hostname,
        config.target!,
      ]);
      const result = await db
        .prepare(
          'INSERT INTO space_domains (space_id, hostname, verification_token, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(space_id) DO NOTHING',
        )
        .bind(spaceId, hostname, `wya-${crypto.randomUUID()}`, now())
        .run();
      if (!result.meta.changes)
        throw new AppError('Remove the current domain before connecting another.', 409);
    } else if (['check', 'redirect', 'remove'].includes(input.action)) {
      if (!(await read(spaceId))) throw new AppError('Connect a domain first.', 404);
      await locked(spaceId, async (row) => {
        if (row.hostname !== input.hostname)
          throw new AppError('The domain changed. Reload these settings.', 409);
        if (input.action === 'remove') return remove(row);
        if (row.removing)
          throw new AppError('Domain removal is still in progress. Please try again shortly.', 409);
        if (input.action === 'redirect') {
          if (typeof input.redirect !== 'boolean')
            throw new AppError('Choose how the Wya address should behave.');
          if (input.redirect && domainStatus(row, now()).status !== 'active')
            throw new AppError('Wait until the domain is active before enabling redirects.');
          await db
            .prepare('UPDATE space_domains SET redirect = ? WHERE space_id = ?')
            .bind(input.redirect ? 1 : 0, spaceId)
            .run();
        } else {
          await consumeLimit(db, `domain-check:${spaceId}`, 4, 60_000, now());
          await refresh(row);
        }
      });
    } else throw new AppError('Unknown domain action.');
    return settings(spaceId);
  }
  async function refreshDue() {
    if (!domainsConfigured(config)) return;
    // Oldest first, bounded work. Unverified claims are checked by their owner only.
    const rows = await db
      .prepare(
        'SELECT space_id FROM space_domains WHERE (verified_at IS NOT NULL OR removing = 1) AND attempted_at < ? ORDER BY attempted_at LIMIT 50',
      )
      .bind(now() - 3_600_000)
      .all<{ space_id: string }>();
    for (const row of rows.results) {
      try {
        await locked(row.space_id, refresh);
      } catch {
        /* Preserve last successful check; stale records fail closed. */
      }
    }
  }
  return { get, change, refreshDue };
}
