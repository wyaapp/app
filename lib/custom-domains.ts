import { AppError } from './app-error.ts';
import { cachedDomainLookup, DOMAIN_LOOKUP_NEGATIVE_TTL } from './domain-cache.ts';
import { resolveHostingMode, type HostingMode } from './plans.ts';

export type DomainRecord = { type: 'TXT' | 'CNAME'; name: string; value: string };
export type DomainRow = {
  space_id: string;
  hostname: string;
  verification_token: string;
  verified_at: number | null;
  provider_id: string | null;
  hostname_status: string;
  ssl_status: string;
  dns_ready: number;
  records: string;
  redirect: number;
  removing: number;
  checked_at: number;
  /** Present only on hosted reads. Null means no Premium access. */
  access_until?: number | null;
};
export type DomainStatus = {
  hostname: string;
  status: 'ownership' | 'pending' | 'active' | 'removing' | 'suspended';
  redirect: boolean;
  checkedAt: number;
  records: DomainRecord[];
  /** Optional while clients can still receive responses from an older deployment. */
  checks?: {
    ownership: 'pending' | 'verified';
    certificate: 'pending' | 'active';
    routing: 'pending' | 'verified';
  };
};
export type DomainSettings = {
  available: boolean;
  entitled: boolean;
  target: string | null;
  domain: DomainStatus | null;
};
export const DOMAIN_STATUS_MAX_AGE = 48 * 60 * 60 * 1000;
export const DOMAIN_HEADER = 'x-wya-domain';

export function normalizeCustomDomain(value: string, reserved: string[] = []) {
  const input = value.trim().toLowerCase();
  if (!input || /[\s/:?#@*\\%]/.test(input))
    throw new AppError('Enter a domain without https://, a path, or a port.');
  let hostname: string;
  try {
    hostname = new URL(`https://${input}`).hostname.replace(/\.$/, '');
  } catch {
    throw new AppError('Enter a valid domain.');
  }
  const labels = hostname.split('.');
  if (
    hostname.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels.at(-1)!) ||
    ['localhost', 'local', 'internal', 'test', 'invalid', 'example'].includes(labels.at(-1)!) ||
    ['wya.im', ...reserved].some((name) => hostname === name || hostname.endsWith(`.${name}`))
  )
    throw new AppError('Choose a public domain that you own.');
  return hostname;
}

export function domainIsActive(row: DomainRow, now = Date.now()) {
  return Boolean(
    domainHasAccess(row, now) &&
    row.verified_at !== null &&
    row.provider_id &&
    row.dns_ready &&
    !row.removing &&
    row.hostname_status === 'active' &&
    row.ssl_status === 'active' &&
    row.checked_at > now - DOMAIN_STATUS_MAX_AGE,
  );
}

function domainHasAccess(row: DomainRow, now: number) {
  return row.access_until === undefined || (row.access_until !== null && row.access_until > now);
}

export function domainStatus(row: DomainRow, now = Date.now()): DomainStatus {
  const active = domainIsActive(row, now);
  return {
    hostname: row.hostname,
    status: row.removing
      ? 'removing'
      : !domainHasAccess(row, now)
        ? 'suspended'
        : active
          ? 'active'
          : row.verified_at === null
            ? 'ownership'
            : 'pending',
    redirect: Boolean(row.redirect) && domainHasAccess(row, now),
    checkedAt: row.checked_at,
    records: [
      { type: 'TXT', name: `_wya.${row.hostname}`, value: row.verification_token },
      ...(JSON.parse(row.records) as DomainRecord[]),
    ],
    checks: {
      // verified_at preserves the hostname claim, even if its TXT later disappears.
      ownership:
        row.verified_at !== null && row.hostname_status !== 'unverified' ? 'verified' : 'pending',
      certificate: row.provider_id && row.ssl_status === 'active' ? 'active' : 'pending',
      // A stored DNS match alone cannot prove that a stale or disabled route works.
      routing: active ? 'verified' : 'pending',
    },
  };
}

export async function activeDomainForSpace(
  db: D1Database,
  spaceId: string,
  hostingMode: HostingMode = 'self-hosted',
) {
  const mode = resolveHostingMode(hostingMode);
  const row = await db
    .prepare(
      mode === 'hosted'
        ? `SELECT d.*, p.premium_until AS access_until FROM space_domains d
         JOIN spaces s ON s.id = d.space_id LEFT JOIN account_plans p ON p.user_id = s.user_id
         WHERE d.space_id = ?`
        : 'SELECT * FROM space_domains WHERE space_id = ?',
    )
    .bind(spaceId)
    .first<DomainRow>();
  return row && domainIsActive(row) ? row : null;
}

export function domainLookup(db: D1Database, hostingMode: HostingMode = 'self-hosted') {
  const mode = resolveHostingMode(hostingMode);
  return cachedDomainLookup(
    db,
    (hostname) =>
      db
        .prepare(
          mode === 'hosted'
            ? `SELECT d.*, s.handle, p.premium_until AS access_until FROM space_domains d
               JOIN spaces s ON s.id = d.space_id LEFT JOIN account_plans p ON p.user_id = s.user_id
               WHERE d.hostname = ? AND d.verified_at IS NOT NULL`
            : 'SELECT d.*, s.handle FROM space_domains d JOIN spaces s ON s.id = d.space_id WHERE d.hostname = ? AND d.verified_at IS NOT NULL',
        )
        .bind(hostname)
        .first<DomainRow & { handle: string }>(),
    (row, now) =>
      domainIsActive(row, now)
        ? Math.min(row.checked_at + DOMAIN_STATUS_MAX_AGE, row.access_until ?? Infinity)
        : now + DOMAIN_LOOKUP_NEGATIVE_TTL,
    mode,
  );
}
