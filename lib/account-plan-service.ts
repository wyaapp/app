import { resolveAccountPlan, resolveHostingMode, type HostingMode } from './plans.ts';

/** Private, provider-managed access projection. Public profile content cannot grant access. */
export function createAccountPlanService(
  db: D1Database,
  hostingMode: HostingMode = 'self-hosted',
  clock: () => number = Date.now,
) {
  const mode = resolveHostingMode(hostingMode);
  async function get(userId: string) {
    // Self-hosted installations never need a payment account or even a billing lookup.
    if (mode === 'self-hosted') return resolveAccountPlan(mode);
    const row = await db
      .prepare('SELECT premium_until FROM account_plans WHERE user_id = ?')
      .bind(userId)
      .first<{ premium_until: number }>();
    return resolveAccountPlan(mode, row?.premium_until ?? null, clock());
  }
  return { get };
}
