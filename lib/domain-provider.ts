import { AppError } from './app-error.ts';
import type { DomainRecord } from './custom-domains.ts';

export type ProviderHostname = {
  id: string;
  hostname: string;
  status?: string;
  ownership_verification?: { type?: string; name?: string; value?: string };
  ssl?: {
    status?: string;
    validation_records?: {
      txt_name?: string;
      txt_value?: string;
      cname?: string;
      cname_target?: string;
    }[];
  };
};
export type DomainProvider = ReturnType<typeof createDomainProvider>;
export type DomainConfig = { zoneId?: string; token?: string; target?: string; origin?: string };

export function domainsConfigured(config: DomainConfig) {
  return Boolean(
    config.token &&
    /^[a-f0-9]{32}$/i.test(config.zoneId ?? '') &&
    config.target &&
    /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(config.target),
  );
}

export function providerRecords(host: ProviderHostname): DomainRecord[] {
  const records: DomainRecord[] = [];
  const own = host.ownership_verification;
  if (own?.type === 'txt' && own.name && own.value)
    records.push({ type: 'TXT', name: own.name, value: own.value });
  for (const record of host.ssl?.validation_records ?? []) {
    if (record.cname && record.cname_target)
      records.push({ type: 'CNAME', name: record.cname, value: record.cname_target });
    else if (record.txt_name && record.txt_value)
      records.push({ type: 'TXT', name: record.txt_name, value: record.txt_value });
  }
  return records;
}

export function createDomainProvider(config: DomainConfig, fetcher: typeof fetch = fetch) {
  async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!domainsConfigured(config))
      throw new AppError('Custom domains are not available yet.', 503);
    try {
      const response = await fetcher(
        `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/custom_hostnames${path}`,
        {
          method,
          headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(10_000),
          redirect: 'manual',
        },
      );
      if (response.status === 404 && method === 'DELETE') return undefined as T;
      if (response.status === 404)
        throw new AppError(
          'The domain registration is unavailable. Remove it and connect it again.',
          409,
        );
      if (!response.ok) throw new Error('Provider request failed');
      const result = (await response.json()) as { success: boolean; result: T };
      if (!result.success) throw new Error('Provider request failed');
      return result.result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Never expose credentials, provider bodies or account details to users/logs.
      throw new AppError('Could not check the domain right now. Please try again.', 503);
    }
  }
  return {
    async find(hostname: string) {
      const existing = await api<ProviderHostname[]>(`?hostname=${encodeURIComponent(hostname)}`);
      return existing.find((item) => item.hostname === hostname) ?? null;
    },
    async ensure(hostname: string) {
      // Recover a registration if a Worker stopped between the provider write and D1 write.
      const existing = await api<ProviderHostname[]>(`?hostname=${encodeURIComponent(hostname)}`);
      const match = existing.find((item) => item.hostname === hostname);
      if (match) return match;
      return api<ProviderHostname>('', 'POST', {
        hostname,
        ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
      });
    },
    get: (id: string) => api<ProviderHostname>(`/${encodeURIComponent(id)}`),
    remove: (id: string) => api<unknown>(`/${encodeURIComponent(id)}`, 'DELETE'),
  };
}

/** Fixed DNS resolver, never an HTTP request to the customer-supplied domain. */
export async function verifyDomainTxt(
  hostname: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  try {
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', `_wya.${hostname}`);
    url.searchParams.set('type', 'TXT');
    const response = await fetcher(url, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(8000),
      redirect: 'manual',
    });
    if (!response.ok) throw new Error('DNS failed');
    const data = (await response.json()) as {
      Status: number;
      Answer?: { type: number; data: string }[];
    };
    if (data.Status !== 0 && data.Status !== 3) throw new Error('DNS failed');
    return (
      data.Answer?.some(
        (answer) =>
          answer.type === 16 && answer.data.replace(/"\s*"/g, '').replace(/^"|"$/g, '') === token,
      ) ?? false
    );
  } catch {
    throw new AppError('Could not check DNS right now. Please try again.', 503);
  }
}

/** CNAME chains, plus flattened apex records, must point at our configured target. */
export async function verifyDomainRouting(
  hostname: string,
  target: string,
  fetcher: typeof fetch = fetch,
) {
  async function answers(name: string, type: string) {
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', name);
    url.searchParams.set('type', type);
    const response = await fetcher(url, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
      redirect: 'manual',
    });
    if (!response.ok) throw new AppError('Could not check DNS right now. Please try again.', 503);
    const data = (await response.json()) as {
      Status: number;
      Answer?: { type: number; data: string }[];
    };
    if (![0, 3].includes(data.Status))
      throw new AppError('Could not check DNS right now. Please try again.', 503);
    return data.Answer ?? [];
  }
  const normalize = (name: string) => name.toLowerCase().replace(/\.$/, '');
  let name = hostname;
  for (let hops = 0; hops < 5; hops++) {
    const cnames = (await answers(name, 'CNAME')).filter((record) => record.type === 5);
    if (cnames.some((record) => normalize(record.data) === normalize(target))) return true;
    if (!cnames.length) break;
    name = normalize(cnames.at(-1)!.data);
  }
  // Apex CNAME flattening hides CNAME records. Resolve both names with the same
  // resolver and compare both address families; never connect to these addresses.
  const [actual4, expected4, actual6, expected6] = await Promise.all([
    answers(hostname, 'A'),
    answers(target, 'A'),
    answers(hostname, 'AAAA'),
    answers(target, 'AAAA'),
  ]);
  const addresses = [...actual4, ...actual6].filter((record) => [1, 28].includes(record.type));
  const expected = [...expected4, ...expected6];
  return (
    addresses.length > 0 &&
    addresses.every((record) =>
      expected.some((other) => other.type === record.type && other.data === record.data),
    )
  );
}
