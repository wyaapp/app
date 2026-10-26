import type { AccountPlanSnapshot } from '@/lib/plans';
import { useTranslation } from '../components/language-provider';

export function spaceLimitReached(plan: AccountPlanSnapshot, count: number) {
  return plan.spaceLimit !== null && count >= plan.spaceLimit;
}

export function canExplorePremium(plan: AccountPlanSnapshot) {
  return plan.hostingMode === 'hosted' && plan.plan === 'free';
}

export function SpacePlanSummary({ plan, count }: { plan: AccountPlanSnapshot; count: number }) {
  const { t } = useTranslation();
  return (
    <div className="space-plan-summary">
      <strong>
        {t(
          plan.hostingMode === 'self-hosted'
            ? 'Self-hosted'
            : plan.plan === 'premium'
              ? 'Premium'
              : 'Free',
        )}
      </strong>
      <span>
        {plan.spaceLimit === null
          ? t('{count} spaces · No space limit', { count })
          : t('{count} of {limit} spaces in use.', { count, limit: plan.spaceLimit })}
      </span>
    </div>
  );
}
