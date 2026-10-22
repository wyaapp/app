import { AppError } from './app-error.ts';

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
};
export type DomainStatus = {
  hostname: string;
  status: 'ownership' | 'pending' | 'active' | 'removing';
  redirect: boolean;
  checkedAt: number;
  records: DomainRecord[];
};
export type DomainSettings = {
  available: boolean;
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
    row.verified_at !== null &&
    row.provider_id &&
    row.dns_ready &&
    !row.removing &&
    row.hostname_status === 'active' &&
    row.ssl_status === 'active' &&
    row.checked_at > now - DOMAIN_STATUS_MAX_AGE,
  );
}

export function domainStatus(row: DomainRow, now = Date.now()): DomainStatus {
  return {
    hostname: row.hostname,
    status: row.removing
      ? 'removing'
      : domainIsActive(row, now)
        ? 'active'
        : row.verified_at === null
          ? 'ownership'
          : 'pending',
    redirect: Boolean(row.redirect),
    checkedAt: row.checked_at,
    records: [
      { type: 'TXT', name: `_wya.${row.hostname}`, value: row.verification_token },
      ...(JSON.parse(row.records) as DomainRecord[]),
    ],
  };
}

export async function activeDomainForSpace(db: D1Database, spaceId: string) {
  const row = await db
    .prepare('SELECT * FROM space_domains WHERE space_id = ?')
    .bind(spaceId)
    .first<DomainRow>();
  return row && domainIsActive(row) ? row : null;
}

export function domainLookup(db: D1Database) {
  return (hostname: string) =>
    db
      .prepare(
        'SELECT d.*, s.handle FROM space_domains d JOIN spaces s ON s.id = d.space_id WHERE d.hostname = ? AND d.verified_at IS NOT NULL',
      )
      .bind(hostname)
      .first<DomainRow & { handle: string }>();
}
