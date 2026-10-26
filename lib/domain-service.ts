import { AppError } from './app-error.ts';
import { consumeLimit, digestKey, limitMutation } from './abuse-limits.ts';
import { invalidateDomainLookup } from './domain-cache.ts';
import { createAccountPlanService } from './account-plan-service.ts';
import { resolveHostingMode } from './plans.ts';
import {
  DOMAIN_QUEUE_LEASE_MS,
  domainCheckDelay,
  type DomainMaintenanceMessage,
  type DomainMaintenanceResult,
  type DomainMaintenanceRow,
} from './domain-maintenance.ts';
import { domainStatus, normalizeCustomDomain, type DomainSettings } from './custom-domains.ts';
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
    random?: () => number;
  } = {},
) {
  const provider = dependencies.provider ?? createDomainProvider(config);
  const verifyTxt = dependencies.verifyTxt ?? verifyDomainTxt;
  const verifyRouting = dependencies.verifyRouting ?? verifyDomainRouting;
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;
  const mode = resolveHostingMode(config.hostingMode);
  const plans = createAccountPlanService(db, mode, now);
  const read = (spaceId: string) =>
    db
      .prepare('SELECT * FROM space_domains WHERE space_id = ?')
      .bind(spaceId)
      .first<DomainMaintenanceRow>();
  async function owned(userId: string, spaceId: string) {
    const owner = await db
      .prepare('SELECT id FROM spaces WHERE id = ? AND user_id = ?')
      .bind(spaceId, userId)
      .first();
    if (!owner) throw new AppError('Space not found.', 404);
  }
  async function canUseDomains(spaceId: string) {
    if (mode === 'self-hosted') return true;
    const grant = await db
      .prepare(
        `SELECT p.premium_until FROM spaces s
        JOIN account_plans p ON p.user_id = s.user_id WHERE s.id = ?`,
      )
      .bind(spaceId)
      .first<{ premium_until: number }>();
    return Boolean(grant && grant.premium_until > now());
  }
  async function settings(userId: string, spaceId: string): Promise<DomainSettings> {
    const row = await read(spaceId);
    const plan = await plans.get(userId);
    return {
      available: domainsConfigured(config),
      entitled: plan.customDomains,
      target: config.target ?? null,
      domain: row
        ? domainStatus(mode === 'hosted' ? { ...row, access_until: plan.premiumUntil } : row, now())
        : null,
    };
  }
  async function get(userId: string, spaceId: string) {
    await owned(userId, spaceId);
    return settings(userId, spaceId);
  }
  async function locked<T>(spaceId: string, callback: (row: DomainMaintenanceRow) => Promise<T>) {
    const lock = crypto.randomUUID();
    const row = await db
      .prepare(
        'UPDATE space_domains SET lock_id = ?, lock_until = ? WHERE space_id = ? AND lock_until < ? RETURNING *',
      )
      .bind(lock, now() + 90_000, spaceId, now())
      .first<DomainMaintenanceRow>();
    if (!row)
      throw new AppError('A domain update is already running. Please try again shortly.', 409);
    try {
      invalidateDomainLookup(db, row.hostname);
      return await callback(row);
    } finally {
      invalidateDomainLookup(db, row.hostname);
      await db
        .prepare(
          'UPDATE space_domains SET lock_id = NULL, lock_until = 0 WHERE space_id = ? AND lock_id = ?',
        )
        .bind(spaceId, lock)
        .run();
    }
  }
  const leaseWhere =
    ' WHERE space_id = ? AND registration_id = ? AND lock_id = ? AND lock_until > ?';
  const leaseValues = (row: DomainMaintenanceRow) => [
    row.space_id,
    row.registration_id,
    row.lock_id,
    now(),
  ];
  async function assertLease(row: DomainMaintenanceRow) {
    const current = await db
      .prepare('SELECT lock_until FROM space_domains' + leaseWhere)
      .bind(...leaseValues(row))
      .first<{ lock_until: number }>();
    // Provider mutations take at most two 10-second requests. Do not begin one
    // close to lease expiry, when a new owner of the row could reuse its hostname.
    if (!current || current.lock_until - now() < 30_000)
      throw new AppError('The domain update expired. Please try again.', 409);
  }
  async function mutateLocked(
    row: DomainMaintenanceRow,
    sql: string,
    values: (string | number | null)[] = [],
  ) {
    const result = await db
      .prepare(sql + leaseWhere)
      .bind(...values, ...leaseValues(row))
      .run();
    if (!result.meta.changes)
      throw new AppError('The domain update expired. Please try again.', 409);
    invalidateDomainLookup(db, row.hostname);
  }
  async function remove(row: DomainMaintenanceRow) {
    // Stop serving/redirecting first. Keep the record to retry failed provider cleanup.
    await mutateLocked(row, 'UPDATE space_domains SET removing = 1, redirect = 0');
    let id = row.provider_id;
    // A verified row without an ID may be a registration interrupted before its D1 save.
    if (!id && row.verified_at !== null) id = (await provider.find(row.hostname))?.id ?? null;
    if (id) {
      await assertLease(row);
      await provider.remove(id);
    }
    await mutateLocked(row, 'DELETE FROM space_domains');
  }
  async function suspend(row: DomainMaintenanceRow) {
    // Keep the verified hostname claim and redirect preference for resubscription,
    // but stop routing before retryable cleanup of the paid provider resource.
    await mutateLocked(
      row,
      "UPDATE space_domains SET hostname_status = 'suspending', dns_ready = 0",
    );
    let id = row.provider_id;
    if (!id && row.verified_at !== null && row.hostname_status !== 'suspended') {
      id = (await provider.find(row.hostname))?.id ?? null;
    }
    if (id) {
      await assertLease(row);
      await provider.remove(id);
    }
    await mutateLocked(
      row,
      "UPDATE space_domains SET provider_id = NULL, hostname_status = 'suspended', ssl_status = 'pending', records = '[]'",
    );
  }
  async function refresh(row: DomainMaintenanceRow) {
    await mutateLocked(row, 'UPDATE space_domains SET attempted_at = ?', [now()]);
    if (row.removing) return remove(row);
    if (!(await canUseDomains(row.space_id))) return suspend(row);
    // Retain the TXT record to keep demonstrating control if a domain changes owners.
    if (!(await verifyTxt(row.hostname, row.verification_token))) {
      await mutateLocked(
        row,
        "UPDATE space_domains SET hostname_status = 'unverified', dns_ready = 0, checked_at = ?",
        [now()],
      );
      return;
    }
    if (row.verified_at === null) {
      try {
        await mutateLocked(row, 'UPDATE space_domains SET verified_at = ?', [now()]);
      } catch (error) {
        if (String(error).includes('UNIQUE'))
          throw new AppError('This domain is already connected to another space.', 409);
        throw error;
      }
    }
    let host;
    try {
      if (!(await canUseDomains(row.space_id))) return suspend(row);
      if (!row.provider_id) await assertLease(row);
      host = row.provider_id
        ? await provider.get(row.provider_id)
        : await provider.ensure(row.hostname);
    } catch (error) {
      if (error instanceof AppError && error.status === 409) {
        await mutateLocked(row, "UPDATE space_domains SET hostname_status = 'unavailable'");
      }
      throw error;
    }
    if (host.hostname !== row.hostname || !host.id)
      throw new AppError('Could not verify the domain registration.', 503);
    const dnsReady =
      host.status === 'active' &&
      host.ssl?.status === 'active' &&
      (await verifyRouting(row.hostname, config.target!));
    if (!(await canUseDomains(row.space_id))) return suspend({ ...row, provider_id: host.id });
    await mutateLocked(
      row,
      'UPDATE space_domains SET provider_id = ?, hostname_status = ?, ssl_status = ?, dns_ready = ?, records = ?, checked_at = ?',
      [
        host.id,
        host.status ?? 'pending',
        host.ssl?.status ?? 'pending',
        dnsReady ? 1 : 0,
        JSON.stringify(providerRecords(host)),
        now(),
      ],
    );
    return dnsReady;
  }
  async function maintain(
    row: DomainMaintenanceRow,
    queued: boolean,
    operation: () => Promise<boolean | void> = () => refresh(row),
  ): Promise<DomainMaintenanceResult> {
    let failure: unknown;
    let active = false;
    try {
      active = (await operation()) === true;
    } catch (error) {
      failure = error;
    }
    const failures = failure ? Math.min(row.check_failures + 1, 10) : 0;
    // Suspended accounts need occasional recovery checks, not five-minute DNS or
    // provider polling. Failed cleanup still follows the bounded retry backoff.
    const inactivePlan = !row.removing && !(await canUseDomains(row.space_id));
    const next = now() + domainCheckDelay(active || inactivePlan, failures, random);
    const keepDelivery = queued && Boolean(failure);
    // Failed checks never change checked_at. A durable next attempt survives a lost
    // Queue retry or DLQ delivery, and registration identity fences a reconnect.
    await db
      .prepare(
        `UPDATE space_domains SET next_check_at = ?, check_failures = ?,
          dispatch_id = ?, queue_claim_id = NULL, queued_until = ?` + leaseWhere,
      )
      .bind(
        next,
        failures,
        keepDelivery ? row.dispatch_id : null,
        keepDelivery ? next + DOMAIN_QUEUE_LEASE_MS : 0,
        ...leaseValues(row),
      )
      .run();
    if (failure) {
      if (!queued) throw failure;
      return { status: 'retry', delaySeconds: Math.max(1, Math.ceil((next - now()) / 1_000)) };
    }
    return { status: 'complete' };
  }
  async function change(
    userId: string,
    spaceId: string,
    input: { action: string; hostname?: string; redirect?: boolean },
  ) {
    await owned(userId, spaceId);
    if (
      (input.action === 'connect' ||
        input.action === 'check' ||
        (input.action === 'redirect' && input.redirect === true)) &&
      !(await plans.get(userId)).customDomains
    )
      throw new AppError('Custom domains require Premium on hosted Wya.', 403);
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
          'INSERT INTO space_domains (space_id, hostname, verification_token, created_at, registration_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(space_id) DO NOTHING',
        )
        .bind(spaceId, hostname, `wya-${crypto.randomUUID()}`, now(), crypto.randomUUID())
        .run();
      if (!result.meta.changes)
        throw new AppError('Remove the current domain before connecting another.', 409);
      invalidateDomainLookup(db, hostname);
    } else if (['check', 'redirect', 'remove'].includes(input.action)) {
      if (!(await read(spaceId))) throw new AppError('Connect a domain first.', 404);
      await locked(spaceId, async (row) => {
        if (row.hostname !== input.hostname)
          throw new AppError('The domain changed. Reload these settings.', 409);
        if (input.action === 'remove') return maintain(row, false, () => remove(row));
        if (row.removing)
          throw new AppError('Domain removal is still in progress. Please try again shortly.', 409);
        if (input.action === 'redirect') {
          if (typeof input.redirect !== 'boolean')
            throw new AppError('Choose how the Wya address should behave.');
          if (input.redirect && domainStatus(row, now()).status !== 'active')
            throw new AppError('Wait until the domain is active before enabling redirects.');
          await mutateLocked(row, 'UPDATE space_domains SET redirect = ?', [
            input.redirect ? 1 : 0,
          ]);
        } else {
          await consumeLimit(db, `domain-check:${spaceId}`, 4, 60_000, now());
          await maintain(row, false);
        }
      });
    } else throw new AppError('Unknown domain action.');
    return settings(userId, spaceId);
  }
  async function refreshDue() {
    if (!domainsConfigured(config)) return;
    // Small local fallback. Production dispatches Queue jobs instead of performing
    // many network/D1 operations in a single scheduled invocation.
    const rows = await db
      .prepare(
        'SELECT space_id FROM space_domains WHERE (verified_at IS NOT NULL OR removing = 1) AND next_check_at <= ? AND queued_until <= ? ORDER BY next_check_at LIMIT 5',
      )
      .bind(now(), now())
      .all<{ space_id: string }>();
    for (const row of rows.results) {
      try {
        await locked(row.space_id, (current) => maintain(current, false));
      } catch {
        /* Preserve last successful check; stale records fail closed. */
      }
    }
  }
  async function processMaintenance(
    message: DomainMaintenanceMessage,
  ): Promise<DomainMaintenanceResult> {
    if (!domainsConfigured(config))
      throw new AppError('Custom domains are not available yet.', 503);
    const current = await read(message.spaceId);
    if (
      !current ||
      current.registration_id !== message.registrationId ||
      current.dispatch_id !== message.dispatchId
    )
      return { status: 'obsolete' };
    try {
      return await locked(message.spaceId, async (row) => {
        if (
          row.registration_id !== message.registrationId ||
          row.dispatch_id !== message.dispatchId
        )
          return { status: 'obsolete' };
        if (row.next_check_at > now())
          return {
            status: 'retry',
            delaySeconds: Math.max(1, Math.ceil((row.next_check_at - now()) / 1_000)),
          };
        return maintain(row, true);
      });
    } catch (error) {
      if (error instanceof AppError && error.status === 409)
        return { status: 'retry', delaySeconds: 60 };
      throw error;
    }
  }
  return { get, change, refreshDue, processMaintenance };
}
