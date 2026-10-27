import type { DomainSettings, DomainStatus } from './custom-domains.ts';
import type { DomainSettingsRequest } from './domain-settings-client.ts';

export const LOCAL_DOMAIN_SCENARIOS = [
  'empty',
  'ownership',
  'https',
  'routing',
  'active',
  'suspended',
  'removing',
  'unavailable',
  'free',
] as const;
export type LocalDomainScenario = (typeof LOCAL_DOMAIN_SCENARIOS)[number];
export type LocalDomainOutcome = 'advance' | 'unchanged' | 'fail';

function fixture(scenario: LocalDomainScenario, hostname: string, now: number): DomainSettings {
  const hasDomain = !['empty', 'unavailable', 'free'].includes(scenario);
  const ownership = !['empty', 'ownership', 'unavailable', 'free'].includes(scenario);
  const certificate = ['routing', 'active', 'removing'].includes(scenario);
  const domain: DomainStatus | null = hasDomain
    ? {
        hostname,
        status:
          scenario === 'active' || scenario === 'suspended' || scenario === 'removing'
            ? scenario
            : scenario === 'ownership'
              ? 'ownership'
              : 'pending',
        redirect: false,
        checkedAt: scenario === 'ownership' ? 0 : now,
        records: [
          { type: 'TXT', name: `_wya.${hostname}`, value: 'wya-local-preview-only' },
          ...(scenario === 'https'
            ? [
                {
                  type: 'TXT' as const,
                  name: `_acme-challenge.${hostname}`,
                  value: 'local-certificate-preview-only',
                },
              ]
            : []),
        ],
        checks: {
          ownership: ownership ? 'verified' : 'pending',
          certificate: certificate ? 'active' : 'pending',
          routing: scenario === 'active' ? 'verified' : 'pending',
        },
      }
    : null;
  return {
    available: scenario !== 'unavailable',
    entitled: !['free', 'suspended'].includes(scenario),
    target: scenario === 'unavailable' ? null : 'domains.example.com',
    domain,
  };
}

function normalizePreviewHostname(value: string | undefined) {
  const hostname = value?.trim().toLowerCase().replace(/\.$/, '') ?? '';
  if (!hostname || /[\s/:?#@*\\%]/.test(hostname))
    throw new Error('Enter a domain without https://, a path, or a port.');
  const labels = hostname.split('.');
  if (
    hostname.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !/^[a-z]{2,63}$/.test(labels.at(-1)!)
  )
    throw new Error('Enter a valid domain.');
  return hostname;
}

function abortError() {
  return new DOMException('The local preview request was cancelled.', 'AbortError');
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Isolated UI fixture: no fetch, DNS, provider, storage, or database access. */
export function createLocalDomainPreview({
  scenario = 'ownership',
  actionDelayMs = 600,
  readDelayMs = 50,
  now = Date.now,
}: {
  scenario?: LocalDomainScenario;
  actionDelayMs?: number;
  readDelayMs?: number;
  now?: () => number;
} = {}) {
  let selectedScenario = scenario;
  let outcome: LocalDomainOutcome = 'advance';
  let generation = 0;
  let settings = fixture(scenario, 'example.com', now());
  const snapshot = () => structuredClone(settings);
  const request: DomainSettingsRequest = async (input, signal) => {
    const startedGeneration = generation;
    await delay(input ? actionDelayMs : readDelayMs, signal);
    if (signal?.aborted || generation !== startedGeneration) throw abortError();
    if (!input) return snapshot();
    if (outcome === 'fail') throw new Error('Could not update domain settings. Please try again.');
    if (!settings.available) throw new Error('Custom domains are not available yet.');
    switch (input.action) {
      case 'connect': {
        if (!settings.entitled) throw new Error('Custom domains are included with Premium.');
        if (settings.domain) throw new Error('Disconnect your current domain first.');
        const hostname = normalizePreviewHostname(input.hostname);
        settings = fixture('ownership', hostname, now());
        break;
      }
      case 'check': {
        const domain = settings.domain;
        if (!domain) throw new Error('Connect a domain first.');
        if (domain.status === 'suspended' || domain.status === 'removing') break;
        if (outcome === 'unchanged') {
          domain.checkedAt = now();
          break;
        }
        const next =
          domain.checks?.ownership !== 'verified'
            ? 'https'
            : domain.checks.certificate !== 'active'
              ? 'routing'
              : 'active';
        settings = fixture(next, domain.hostname, now());
        settings.domain!.redirect = domain.redirect;
        break;
      }
      case 'redirect':
        if (settings.domain?.status !== 'active')
          throw new Error('Your domain must be active before enabling redirects.');
        if (typeof input.redirect !== 'boolean') throw new Error('Invalid domain settings.');
        settings.domain.redirect = input.redirect;
        break;
      case 'remove':
        if (!settings.domain) throw new Error('Connect a domain first.');
        settings.domain = null;
        break;
      default:
        throw new Error('Invalid domain settings.');
    }
    return snapshot();
  };
  return {
    request,
    snapshot,
    setScenario(next: LocalDomainScenario) {
      generation++;
      selectedScenario = next;
      settings = fixture(next, settings.domain?.hostname ?? 'example.com', now());
      return snapshot();
    },
    reset() {
      generation++;
      outcome = 'advance';
      settings = fixture(selectedScenario, 'example.com', now());
      return snapshot();
    },
    setOutcome(next: LocalDomainOutcome) {
      outcome = next;
    },
  };
}
