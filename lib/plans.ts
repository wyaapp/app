export type HostingMode = 'hosted' | 'self-hosted';
export type AccountPlanSnapshot = {
  hostingMode: HostingMode;
  plan: 'free' | 'premium';
  spaceLimit: number | null;
  customDomains: boolean;
  /** Exclusive access deadline in Unix milliseconds; null when Premium is inactive. */
  premiumUntil: number | null;
};

export const HOSTED_FREE_SPACE_LIMIT = 2;
export const HOSTED_PREMIUM_SPACE_LIMIT = 10;
/** Approved hosted launch prices, in the currency's minor units. Monthly only. */
export const HOSTED_PREMIUM_MONTHLY_PRICES = { usd: 299, brl: 999 } as const;

/** Self-hosting includes every feature and requires no license or billing service. */
export function resolveHostingMode(value?: string): HostingMode {
  if (!value || value === 'self-hosted') return 'self-hosted';
  if (value === 'hosted') return 'hosted';
  throw new Error('WYA_HOSTING_MODE must be hosted or self-hosted.');
}

export function resolveAccountPlan(
  hostingMode: HostingMode,
  premiumUntil: number | null = null,
  now = Date.now(),
): AccountPlanSnapshot {
  if (hostingMode === 'self-hosted') {
    return { hostingMode, plan: 'free', spaceLimit: null, customDomains: true, premiumUntil: null };
  }
  const premium = premiumUntil !== null && Number.isSafeInteger(premiumUntil) && premiumUntil > now;
  return {
    hostingMode,
    plan: premium ? 'premium' : 'free',
    spaceLimit: premium ? HOSTED_PREMIUM_SPACE_LIMIT : HOSTED_FREE_SPACE_LIMIT,
    customDomains: premium,
    premiumUntil: premium ? premiumUntil : null,
  };
}
