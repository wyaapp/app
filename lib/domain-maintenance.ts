import type { DomainRow } from './custom-domains.ts';

export const DOMAIN_QUEUE_LEASE_MS = 15 * 60_000;
export const DOMAIN_DISPATCH_LIMIT = 1_000;
const SEND_BATCH_SIZE = 100;
export type DomainMaintenanceRow = DomainRow & {
  registration_id: string;
  next_check_at: number;
  queued_until: number;
  dispatch_id: string | null;
  queue_claim_id: string | null;
  check_failures: number;
  lock_id: string | null;
  lock_until: number;
};
export type DomainMaintenanceMessage = {
  version: 1;
  spaceId: string;
  registrationId: string;
  dispatchId: string;
};
export type DomainMaintenanceResult =
  { status: 'complete' | 'obsolete' } | { status: 'retry'; delaySeconds: number };

/** Jitter spreads checks across ticks; all failures remain bounded below one hour. */
export function domainCheckDelay(active: boolean, failures = 0, random = Math.random) {
  const base = failures
    ? Math.min(50 * 60_000, 5 * 60_000 * 2 ** Math.min(failures - 1, 6))
    : active
      ? 6 * 3_600_000
      : 5 * 60_000;
  return Math.round(base * (0.8 + random() * 0.4));
}

export function isDomainMaintenanceMessage(value: unknown): value is DomainMaintenanceMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DomainMaintenanceMessage>;
  return (
    item.version === 1 &&
    typeof item.spaceId === 'string' &&
    item.spaceId.length > 0 &&
    item.spaceId.length <= 256 &&
    typeof item.registrationId === 'string' &&
    /^[a-f0-9-]{32,36}$/i.test(item.registrationId) &&
    typeof item.dispatchId === 'string' &&
    /^[a-f0-9-]{32,36}$/i.test(item.dispatchId)
  );
}

/** D1 is the durable source of work. Expired enqueue leases recover lost/DLQ messages. */
export async function dispatchDomainMaintenance(
  db: D1Database,
  queue: Pick<Queue<DomainMaintenanceMessage>, 'sendBatch'>,
  { now = Date.now }: { now?: () => number } = {},
) {
  const startedAt = now();
  let enqueued = 0;
  let sendFailures = 0;
  for (let offset = 0; offset < DOMAIN_DISPATCH_LIMIT; offset += SEND_BATCH_SIZE) {
    const dispatchId = crypto.randomUUID();
    // A single atomic statement keeps concurrent cron invocations from claiming the same rows.
    const claimed = await db
      .prepare(
        `UPDATE space_domains SET dispatch_id = COALESCE(dispatch_id, ?), queue_claim_id = ?, queued_until = ? WHERE space_id IN (
          SELECT space_id FROM space_domains
          WHERE (verified_at IS NOT NULL OR removing = 1)
            AND next_check_at <= ? AND queued_until <= ? AND lock_until < ?
          ORDER BY queued_until, next_check_at, space_id LIMIT ?
        ) RETURNING space_id, registration_id, dispatch_id`,
      )
      .bind(
        dispatchId,
        dispatchId,
        startedAt + DOMAIN_QUEUE_LEASE_MS,
        startedAt,
        startedAt,
        startedAt,
        SEND_BATCH_SIZE,
      )
      .all<{ space_id: string; registration_id: string; dispatch_id: string }>();
    if (!claimed.results.length) break;
    try {
      await queue.sendBatch(
        claimed.results.map((row) => ({
          body: {
            version: 1 as const,
            spaceId: row.space_id,
            registrationId: row.registration_id,
            dispatchId: row.dispatch_id,
          },
          contentType: 'json' as const,
        })),
      );
      enqueued += claimed.results.length;
    } catch {
      // Delivery may have succeeded despite a network error. Keep the stable job ID:
      // either delivery can finish it, while row locks and completion fence duplicates.
      // A consumer that already moved its retry lease must not have it cleared here.
      await db
        .prepare(
          'UPDATE space_domains SET queue_claim_id = NULL, queued_until = 0 WHERE queue_claim_id = ? AND queued_until = ?',
        )
        .bind(dispatchId, startedAt + DOMAIN_QUEUE_LEASE_MS)
        .run();
      sendFailures++;
      break;
    }
    if (claimed.results.length < SEND_BATCH_SIZE) break;
  }
  // Bound monitoring reads too. This is a capped sample, never an unbounded COUNT scan.
  const backlog = await db
    .prepare(
      `SELECT COUNT(*) AS count, MIN(next_check_at) AS oldest_due,
        MIN(CASE WHEN checked_at > 0 THEN checked_at END) AS oldest_checked
       FROM (SELECT next_check_at, checked_at FROM space_domains
        WHERE (verified_at IS NOT NULL OR removing = 1) AND next_check_at <= ?
        ORDER BY next_check_at LIMIT 1001)`,
    )
    .bind(startedAt)
    .first<{ count: number; oldest_due: number | null; oldest_checked: number | null }>();
  return {
    enqueued,
    sendFailures,
    dueSample: Math.min(backlog?.count ?? 0, 1_000),
    dueSampleCapped: (backlog?.count ?? 0) > 1_000,
    oldestDueAgeMs:
      backlog?.oldest_due !== null && backlog?.oldest_due !== undefined
        ? Math.max(0, startedAt - backlog.oldest_due)
        : 0,
    oldestVerificationAgeMs: backlog?.oldest_checked
      ? Math.max(0, startedAt - backlog.oldest_checked)
      : 0,
  };
}

/** Sequential small batches bound D1 calls and avoid a burst of provider API requests. */
export async function consumeDomainMaintenance(
  batch: MessageBatch<unknown>,
  process: (message: DomainMaintenanceMessage) => Promise<DomainMaintenanceResult>,
) {
  const counts = { completed: 0, obsolete: 0, retried: 0, invalid: 0, failed: 0 };
  for (const message of batch.messages) {
    if (!isDomainMaintenanceMessage(message.body)) {
      message.ack();
      counts.invalid++;
      continue;
    }
    try {
      const result = await process(message.body);
      if (result.status === 'retry') {
        message.retry({ delaySeconds: result.delaySeconds });
        counts.retried++;
      } else {
        message.ack();
        if (result.status === 'complete') counts.completed++;
        else counts.obsolete++;
      }
    } catch {
      // Database/provider failures never log credentials, hostnames or DNS tokens.
      message.retry({ delaySeconds: 300 });
      counts.failed++;
    }
  }
  return counts;
}
