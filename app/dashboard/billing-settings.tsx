'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowsClockwise';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { CreditCardIcon } from '@phosphor-icons/react/dist/ssr/CreditCard';
import {
  HOSTED_FREE_SPACE_LIMIT,
  HOSTED_PREMIUM_SPACE_LIMIT,
  HOSTED_PREMIUM_MONTHLY_PRICES,
  type AccountPlanSnapshot,
} from '@/lib/plans';
import { useTranslation } from '../components/language-provider';
import type { ActiveWorkspace } from './use-workspace';
import { SpacePlanSummary } from './space-plan-summary';

type Currency = 'usd' | 'brl';
type Interval = 'month' | 'year';
type BillingSettingsResponse = {
  plan: AccountPlanSnapshot;
  available: boolean;
  prices: { currency: Currency; interval: Interval; amount: number }[];
  hasCustomer: boolean;
  subscription?: {
    status: string;
    currency: Currency;
    interval: Interval;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: number | null;
  };
};

export function BillingSettings({ workspace }: { workspace: ActiveWorkspace }) {
  const { locale, t } = useTranslation();
  const { plan, setPlan } = workspace;
  const [settings, setSettings] = useState<BillingSettingsResponse | null>(null);
  const [currency, setCurrency] = useState<Currency>(locale === 'pt-BR' ? 'brl' : 'usd');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const actionRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let disposed = false;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const checkout = new URL(window.location.href).searchParams.get('checkout');
    let awaitingConfirmation = checkout === 'success';

    async function refresh() {
      if (disposed || request) return;
      clearTimeout(timer);
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 12000);
      setRefreshing(true);
      if (awaitingConfirmation) polls++;
      try {
        const response = await fetch('/api/billing', {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = (await response.json()) as BillingSettingsResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load billing settings.');
        if (disposed) return;
        setSettings(data);
        setPlan(data.plan);
        setError('');
        // A successful checkout return is only a request to check the server.
        // Only the verified server plan can activate Premium in the interface.
        if (checkout === 'success' && data.plan.plan === 'premium') {
          awaitingConfirmation = false;
          setConfirming(false);
          setMessage('Premium is active. Your spaces are ready.');
          const url = new URL(window.location.href);
          url.searchParams.delete('checkout');
          window.history.replaceState(window.history.state, '', url);
        }
      } catch (cause) {
        if (!disposed)
          setError(
            controller.signal.aborted
              ? 'Billing settings took too long to load. Try again.'
              : cause instanceof Error
                ? cause.message
                : 'Could not load billing settings.',
          );
      } finally {
        clearTimeout(timeout);
        request = null;
        if (!disposed) {
          setRefreshing(false);
          if (awaitingConfirmation && polls < 10) {
            timer = setTimeout(() => void refresh(), Math.min(1500 * polls, 5000));
          } else if (awaitingConfirmation) {
            awaitingConfirmation = false;
            setConfirming(false);
            setMessage(
              'Payment confirmation is still pending. Refresh in a moment to check your plan.',
            );
          }
        }
      }
    }
    const onFocus = () => void refresh();
    // Wait until mounting has settled; Strict Mode can cancel this initial read.
    timer = setTimeout(() => {
      setConfirming(awaitingConfirmation);
      if (checkout === 'cancel' || checkout === 'cancelled' || checkout === 'canceled')
        setMessage('Checkout was canceled. Your plan has not changed.');
      void refresh();
    }, 0);
    window.addEventListener('focus', onFocus);
    return () => {
      disposed = true;
      clearTimeout(timer);
      request?.abort();
      window.removeEventListener('focus', onFocus);
    };
  }, [attempt, setPlan]);

  useEffect(
    () => () => {
      actionRequest.current?.abort();
      actionRequest.current = null;
    },
    [],
  );

  const hosted = plan.hostingMode === 'hosted';
  const prices = (settings?.prices ?? []).filter((entry) => entry.interval === 'month');
  const checkoutPrice = prices.find(
    (entry) =>
      entry.currency === currency && entry.amount === HOSTED_PREMIUM_MONTHLY_PRICES[currency],
  );
  // Approved prices remain visible before Stripe is enabled. Checkout requires
  // the server to validate matching Stripe Price objects for both currencies.
  const price = checkoutPrice ?? {
    currency,
    interval: 'month' as const,
    amount: HOSTED_PREMIUM_MONTHLY_PRICES[currency],
  };
  const subscription = settings?.subscription;
  const liveSubscription =
    subscription && !['canceled', 'incomplete_expired'].includes(subscription.status);
  const canSubscribe = hosted && plan.plan === 'free' && !liveSubscription;
  const overLimit = plan.spaceLimit !== null && workspace.spaces.length > plan.spaceLimit;
  const endDate = subscription?.currentPeriodEnd
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(subscription.currentPeriodEnd)
    : null;

  async function openBilling(action: 'checkout' | 'portal') {
    if (actionRequest.current || busy) return;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    actionRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      if (!(await workspace.finishEntry())) return;
      const response = await fetch('/api/billing', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'checkout' ? { action, currency, interval: 'month' } : { action },
        ),
      });
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok)
        throw new Error(result.error || 'Could not open billing. Please try again.');
      const url = new URL(result.url || '');
      if (
        url.protocol !== 'https:' ||
        !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)
      )
        throw new Error('Could not open billing. Please try again.');
      if (!controller.signal.aborted) window.location.assign(url.href);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Could not open billing. Please try again.',
        );
      else if (actionRequest.current === controller)
        setError('Billing took too long to respond. Please try again.');
    } finally {
      clearTimeout(timeout);
      if (actionRequest.current === controller) {
        actionRequest.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section className="editor-panel billing-settings" aria-labelledby="billing-heading">
      <header className="billing-heading">
        <div>
          <CreditCardIcon size={24} aria-hidden="true" />
          <h2 id="billing-heading">{t('Plans & billing')}</h2>
        </div>
        <button
          type="button"
          className="billing-refresh"
          disabled={refreshing || busy}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <ArrowsClockwiseIcon size={17} aria-hidden="true" />
          {t(refreshing ? 'Refreshing…' : 'Refresh plan')}
        </button>
      </header>
      <p className="billing-intro">
        {t(
          hosted
            ? 'One plan for your account. Use it across all your spaces.'
            : 'Self-hosted is free forever, with every feature included.',
        )}
      </p>
      <SpacePlanSummary plan={plan} count={workspace.spaces.length} />
      {overLimit && (
        <p className="billing-notice">
          {t(
            'Your existing spaces are kept. You can create another space when your account is below its plan limit.',
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="billing-error">
          {t(error)}
        </p>
      )}
      {(message || confirming) && (
        <p role="status" className="billing-notice">
          {t(confirming ? 'Confirming your payment…' : message)}
        </p>
      )}
      {!hosted ? (
        <ul className="billing-features">
          {['Unlimited spaces', 'Custom domains included', 'No subscription required'].map(
            (feature) => (
              <li key={feature}>
                <CheckIcon size={18} aria-hidden="true" />
                <span>{t(feature)}</span>
              </li>
            ),
          )}
        </ul>
      ) : (
        <>
          <div className="billing-plans">
            <article className={`billing-plan ${plan.plan === 'free' ? 'is-current' : ''}`}>
              <div className="billing-plan-title">
                <h3>{t('Free')}</h3>
                {plan.plan === 'free' && <span>{t('Current plan')}</span>}
              </div>
              <ul className="billing-features">
                <li>
                  <CheckIcon size={18} aria-hidden="true" />
                  <span>{t('Up to {count} spaces', { count: HOSTED_FREE_SPACE_LIMIT })}</span>
                </li>
                <li>
                  <CheckIcon size={18} aria-hidden="true" />
                  <span>{t('Your Wya address for every space')}</span>
                </li>
              </ul>
            </article>
            <article className={`billing-plan ${plan.plan === 'premium' ? 'is-current' : ''}`}>
              <div className="billing-plan-title">
                <h3>{t('Premium')}</h3>
                {plan.plan === 'premium' && <span>{t('Current plan')}</span>}
              </div>
              <ul className="billing-features">
                <li>
                  <CheckIcon size={18} aria-hidden="true" />
                  <span>{t('Up to {count} spaces', { count: HOSTED_PREMIUM_SPACE_LIMIT })}</span>
                </li>
                <li>
                  <CheckIcon size={18} aria-hidden="true" />
                  <span>{t('One custom domain per space')}</span>
                </li>
              </ul>
            </article>
          </div>
          {subscription && (
            <div className="billing-subscription window-section-divider">
              <strong>
                {t(
                  subscription.cancelAtPeriodEnd
                    ? 'Subscription ending'
                    : subscription.status === 'active' || subscription.status === 'trialing'
                      ? 'Subscription active'
                      : subscription.status === 'canceled' ||
                          subscription.status === 'incomplete_expired'
                        ? 'Subscription ended'
                        : 'Check your payment status',
                )}
              </strong>
              {endDate && (
                <p>
                  {t(
                    subscription.cancelAtPeriodEnd || subscription.status === 'canceled'
                      ? 'Current period ends on {date}.'
                      : 'Current billing period ends on {date}.',
                    { date: endDate },
                  )}
                </p>
              )}
            </div>
          )}
          {!settings && !error && <p role="status">{t('Loading billing options…')}</p>}
          {settings && canSubscribe && (
            <div className="billing-purchase window-section-divider">
              <div className="billing-options">
                <label>
                  {t('Currency')}
                  <select
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value as Currency)}
                    disabled={busy || confirming}
                  >
                    <option value="usd">USD · {t('US dollar')}</option>
                    <option value="brl">BRL · {t('Brazilian real')}</option>
                  </select>
                </label>
              </div>
              <p className="billing-price">
                <strong>
                  {new Intl.NumberFormat(locale, {
                    style: 'currency',
                    currency: price.currency.toUpperCase(),
                  }).format(price.amount / 100)}
                </strong>
                <span>{t('per month')}</span>
              </p>
              {settings.available ? (
                <p className="billing-caption">
                  {t('The final total and any taxes are shown securely at checkout.')}
                </p>
              ) : (
                <p className="billing-notice">
                  {t('Subscriptions are not available yet. Your current plan stays available.')}
                </p>
              )}
              <button
                type="button"
                className="button button-dark"
                disabled={busy || confirming || !settings.available || !checkoutPrice}
                onClick={() => void openBilling('checkout')}
              >
                {t(busy ? 'Opening…' : 'Subscribe to Premium')}
                <ArrowUpRightIcon size={18} aria-hidden="true" />
              </button>
            </div>
          )}
          {settings?.hasCustomer && (
            <div className="billing-manage window-section-divider">
              <button
                type="button"
                className="button button-light"
                disabled={busy || !settings.available}
                onClick={() => void openBilling('portal')}
              >
                {t(busy ? 'Opening…' : 'Manage billing')}
                <ArrowUpRightIcon size={18} aria-hidden="true" />
              </button>
              <p className="billing-caption">
                {t('Update payment details, view invoices, or cancel your subscription in Stripe.')}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
