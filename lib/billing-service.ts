import { AppError } from './app-error.ts';
import { consumeLimit, digestKey } from './abuse-limits.ts';
import { invalidateDomainLookup } from './domain-cache.ts';
import { HOSTED_PREMIUM_MONTHLY_PRICES } from './plans.ts';

export type BillingCurrency = 'usd' | 'brl';
export type BillingInterval = 'month' | 'year';
export type BillingConfig = {
  hostingMode: 'hosted' | 'self-hosted';
  secretKey?: string;
  webhookSecret?: string;
  origin?: string;
  prices: Record<BillingCurrency, Partial<Record<BillingInterval, string>>>;
};
export type BillingPrice = { currency: BillingCurrency; interval: BillingInterval; amount: number };
export type BillingStatus = {
  available: boolean;
  prices: BillingPrice[];
  hasCustomer: boolean;
  subscription?: {
    status: string;
    currency: BillingCurrency;
    interval: BillingInterval;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: number;
  };
};
type Account = {
  user_id: string;
  customer_id: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  currency: BillingCurrency | null;
  interval: BillingInterval | null;
  current_period_end: number;
  cancel_at_period_end: number;
  paid_until: number;
  checkout_id: string | null;
  checkout_url: string | null;
  checkout_price_id: string | null;
  checkout_key: string | null;
  checkout_expires_at: number;
  lock_id: string;
  lock_until: number;
};
type StripePrice = {
  id: string;
  active: boolean;
  type: string;
  currency: string;
  unit_amount: number;
  billing_scheme: string;
  transform_quantity: { divide_by: number; round: string } | null;
  recurring?: { interval: string; interval_count: number; usage_type: string };
  livemode: boolean;
};
type Invoice = {
  id: string;
  customer: string;
  status: string;
  paid: boolean;
  lines: {
    has_more: boolean;
    data: Array<{
      pricing?: { price_details?: { price?: string } };
      parent?: { subscription_item_details?: { subscription?: string; proration?: boolean } };
      period: { start: number; end: number };
    }>;
  };
};
type Subscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  livemode: boolean;
  latest_invoice: Invoice | string | null;
  items: {
    has_more: boolean;
    data: Array<{
      price: StripePrice;
      quantity: number;
      current_period_start: number;
      current_period_end: number;
    }>;
  };
};
type Session = {
  id: string;
  url: string | null;
  customer: string;
  status: string;
  expires_at: number;
  subscription?: string | null;
};
type Snapshot = {
  id: string | null;
  status: string | null;
  currency: BillingCurrency | null;
  interval: BillingInterval | null;
  end: number;
  cancel: boolean;
  paidUntil: number;
};
const LOCK_MS = 90_000;
const DAY_MS = 86_400_000;
const priceCache = new Map<string, { until: number; value: BillingPrice }>();
const API_VERSION = '2025-06-30.basil';
const EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'invoice.voided',
  'invoice.marked_uncollectible',
]);
const unavailable = () =>
  new AppError('Billing is temporarily unavailable. Please try again later.', 503);
function stripeId(value: unknown, prefix: string): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,200}$`).test(value);
}
function secondsMs(value: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 1000
    ? value * 1000
    : 0;
}
function redirectUrl(value: unknown, host: string) {
  if (typeof value !== 'string') throw unavailable();
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password)
    throw unavailable();
  return value;
}

/** Verify the exact raw request bytes before JSON parsing. WebCrypto verifies HMAC in constant time. */
export async function verifyBillingSignature(
  raw: string,
  signature: string,
  secret: string,
  now = Date.now(),
) {
  if (new TextEncoder().encode(raw).length > 262_144 || signature.length > 2048) return false;
  const parts = signature.split(',').map((part) => part.trim().split('='));
  const times = parts.filter(([name]) => name === 't');
  const signatures = parts.filter(
    ([name, value]) => name === 'v1' && /^[a-f0-9]{64}$/i.test(value || ''),
  );
  if (
    times.length !== 1 ||
    !/^\d{1,12}$/.test(times[0][1]) ||
    !signatures.length ||
    signatures.length > 8
  )
    return false;
  const timestamp = Number(times[0][1]);
  if (Math.abs(Math.floor(now / 1000) - timestamp) > 300) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const payload = encoder.encode(`${timestamp}.${raw}`);
  for (const [, value] of signatures) {
    const bytes = Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, payload)) return true;
  }
  return false;
}

export function createBillingService(
  db: D1Database,
  config: BillingConfig,
  dependencies: { fetcher?: typeof fetch; now?: () => number; cachePrices?: boolean } = {},
) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  const live = /^(?:sk|rk)_live_/.test(config.secretKey || '');
  const configured = (['usd', 'brl'] as const).flatMap((currency) => {
    const id = config.prices[currency]?.month;
    return id
      ? [
          {
            id,
            currency,
            interval: 'month' as const,
            amount: HOSTED_PREMIUM_MONTHLY_PRICES[currency],
          },
        ]
      : [];
  });
  const available =
    config.hostingMode === 'hosted' &&
    !!config.secretKey &&
    !!config.webhookSecret &&
    !!config.origin &&
    configured.length === 2 &&
    configured.every((price) => stripeId(price.id, 'price')) &&
    new Set(configured.map((price) => price.id)).size === configured.length;
  function requireAvailable() {
    if (!available) throw unavailable();
  }
  function returnUrl(suffix = '') {
    const origin = new URL(config.origin!);
    if (
      origin.username ||
      origin.password ||
      (origin.protocol !== 'https:' &&
        !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))
    )
      throw unavailable();
    return `${origin.origin}/dashboard/billing${suffix}`;
  }
  async function api<T>(path: string, body?: URLSearchParams, idempotencyKey?: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetcher(`https://api.stripe.com/v1/${path}`, {
        method: body ? 'POST' : 'GET',
        // Workers does not implement redirect: 'error'. Keep redirects manual
        // and reject every non-2xx response before parsing or following anything.
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          'Stripe-Version': API_VERSION,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body,
      });
      if (!response.ok) throw unavailable();
      return (await response.json()) as T;
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timeout);
    }
  }
  async function limit(userId: string, mutation = false) {
    const key = await digestKey(userId);
    await consumeLimit(
      db,
      `billing-${mutation ? 'write' : 'read'}-minute:${key}`,
      mutation ? 5 : 20,
      60_000,
      now(),
    );
    await consumeLimit(
      db,
      `billing-${mutation ? 'write' : 'read'}-hour:${key}`,
      mutation ? 30 : 120,
      3_600_000,
      now(),
    );
  }
  async function account(userId: string) {
    return db
      .prepare('SELECT * FROM billing_accounts WHERE user_id = ?')
      .bind(userId)
      .first<Account>();
  }
  async function locked<T>(userId: string, work: (row: Account) => Promise<T>): Promise<T> {
    await db
      .prepare(
        'INSERT INTO billing_accounts (user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING',
      )
      .bind(userId, now())
      .run();
    const token = crypto.randomUUID();
    const row = await db
      .prepare(
        `UPDATE billing_accounts SET lock_id = ?, lock_until = ?
      WHERE user_id = ? AND lock_until <= ? RETURNING *`,
      )
      .bind(token, now() + LOCK_MS, userId, now())
      .first<Account>();
    if (!row) throw new AppError('Billing is updating. Please try again shortly.', 503);
    try {
      return await work(row);
    } finally {
      await db
        .prepare(
          'UPDATE billing_accounts SET lock_id = NULL, lock_until = 0 WHERE user_id = ? AND lock_id = ?',
        )
        .bind(userId, token)
        .run();
    }
  }
  async function assertLease(row: Account) {
    const current = await db
      .prepare('SELECT lock_until FROM billing_accounts WHERE user_id = ? AND lock_id = ?')
      .bind(row.user_id, row.lock_id)
      .first<{ lock_until: number }>();
    if (!current || current.lock_until - now() < 15_000) throw unavailable();
  }
  async function update(row: Account, assignments: string, values: (string | number | null)[]) {
    const result = await db
      .prepare(
        `UPDATE billing_accounts SET ${assignments}, updated_at = ?
      WHERE user_id = ? AND lock_id = ? AND lock_until > ?`,
      )
      .bind(...values, now(), row.user_id, row.lock_id, now())
      .run();
    if (result.meta.changes !== 1) throw unavailable();
  }
  function identify(price: StripePrice) {
    const selected = configured.find((entry) => entry.id === price?.id);
    if (
      !selected ||
      price.type !== 'recurring' ||
      price.billing_scheme !== 'per_unit' ||
      price.transform_quantity !== null ||
      price.currency !== selected.currency ||
      price.unit_amount !== selected.amount ||
      price.recurring?.interval !== selected.interval ||
      price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== 'licensed' ||
      price.livemode !== live
    )
      return null;
    return selected;
  }
  async function prices() {
    return Promise.all(
      configured.map(async (selected) => {
        const cached = dependencies.cachePrices !== false ? priceCache.get(selected.id) : null;
        if (
          cached &&
          cached.until > now() &&
          cached.value.currency === selected.currency &&
          cached.value.interval === selected.interval &&
          cached.value.amount === selected.amount
        )
          return cached.value;
        const price = await api<StripePrice>(`prices/${encodeURIComponent(selected.id)}`);
        if (
          !identify(price) ||
          !price.active ||
          price.type !== 'recurring' ||
          !Number.isSafeInteger(price.unit_amount) ||
          price.unit_amount <= 0
        )
          throw unavailable();
        const value = {
          currency: selected.currency,
          interval: selected.interval,
          amount: price.unit_amount,
        };
        if (dependencies.cachePrices !== false) {
          if (priceCache.size >= 64) priceCache.delete(priceCache.keys().next().value!);
          priceCache.set(selected.id, { until: now() + 300_000, value });
        }
        return value;
      }),
    );
  }
  async function subscriptions(row: Account) {
    if (!row.customer_id) return [];
    const query = new URLSearchParams({
      customer: row.customer_id,
      status: 'all',
      limit: '100',
      'expand[]': 'data.latest_invoice',
    });
    const result = await api<{ data: Subscription[]; has_more: boolean }>(`subscriptions?${query}`);
    if (
      !Array.isArray(result.data) ||
      result.has_more ||
      result.data.some(
        (sub) =>
          sub.customer !== row.customer_id || sub.livemode !== live || !stripeId(sub.id, 'sub'),
      )
    )
      throw unavailable();
    return result.data;
  }
  async function snapshot(row: Account, subs: Subscription[]): Promise<Snapshot> {
    let selected: Snapshot = {
      id: null,
      status: null,
      currency: null,
      interval: null,
      end: 0,
      cancel: false,
      paidUntil: 0,
    };
    let invoiceReads = 0;
    for (const sub of subs) {
      if (sub.items?.has_more || sub.items?.data?.length !== 1) continue;
      const item = sub.items.data[0];
      const plan = identify(item.price);
      if (!plan || item.quantity !== 1) continue;
      let paidUntil = 0;
      const end = secondsMs(item.current_period_end);
      if (['active', 'past_due'].includes(sub.status)) {
        // Preserve only a previously verified paid period; failed renewal never buys more time.
        if (row.subscription_id === sub.id) paidUntil = Math.min(row.paid_until, end);
        if (typeof sub.latest_invoice === 'string') {
          if (++invoiceReads > 4 || !stripeId(sub.latest_invoice, 'in')) throw unavailable();
          await assertLease(row);
        }
        const invoice =
          typeof sub.latest_invoice === 'string'
            ? await api<Invoice>(`invoices/${encodeURIComponent(sub.latest_invoice)}`)
            : sub.latest_invoice;
        if (
          invoice &&
          invoice.customer === row.customer_id &&
          invoice.status === 'paid' &&
          invoice.paid === true
        ) {
          if (!invoice.lines || invoice.lines.has_more || !Array.isArray(invoice.lines.data))
            throw unavailable();
          for (const line of invoice.lines.data) {
            if (
              line.pricing?.price_details?.price !== item.price.id ||
              line.parent?.subscription_item_details?.subscription !== sub.id ||
              line.parent.subscription_item_details.proration
            )
              continue;
            paidUntil = Math.max(paidUntil, Math.min(end, secondsMs(line.period?.end)));
          }
        }
      }
      const candidate = {
        id: sub.id,
        status: sub.status,
        currency: plan.currency,
        interval: plan.interval,
        end,
        cancel: !!sub.cancel_at_period_end,
        paidUntil,
      };
      // Prefer paid access, then a live subscription that needs attention, then history.
      const terminal = (status: string | null) =>
        !status || ['canceled', 'incomplete_expired'].includes(status);
      const liveCandidate = Number(!terminal(candidate.status));
      const liveSelected = Number(!terminal(selected.status));
      if (
        !selected.id ||
        paidUntil > selected.paidUntil ||
        (paidUntil === selected.paidUntil &&
          (liveCandidate > liveSelected || (liveCandidate === liveSelected && end > selected.end)))
      ) {
        selected = candidate;
      }
    }
    return selected;
  }
  async function project(row: Account, state: Snapshot, eventId?: string) {
    const hosts = await db
      .prepare(
        'SELECT hostname FROM space_domains WHERE space_id IN (SELECT id FROM spaces WHERE user_id = ?)',
      )
      .bind(row.user_id)
      .all<{ hostname: string }>();
    for (const host of hosts.results) invalidateDomainLookup(db, host.hostname);
    await assertLease(row);
    const timestamp = now();
    const fence = [row.user_id, row.lock_id, timestamp];
    const valid =
      'SELECT 1 FROM billing_accounts WHERE user_id = ? AND lock_id = ? AND lock_until > ?';
    try {
      // D1 batch is transactional. Reset routing before an expired account regains access.
      const statements = [
        db
          .prepare(
            `UPDATE space_domains SET dns_ready = 0, hostname_status = 'pending', next_check_at = 0
          WHERE space_id IN (SELECT id FROM spaces WHERE user_id = ?)
          AND ? > ? AND NOT EXISTS (SELECT 1 FROM account_plans WHERE user_id = ? AND premium_until > ?)
          AND EXISTS (${valid})`,
          )
          .bind(row.user_id, state.paidUntil, timestamp, row.user_id, timestamp, ...fence),
        db
          .prepare(
            `UPDATE billing_accounts SET subscription_id = ?, subscription_status = ?, currency = ?, interval = ?,
          current_period_end = ?, cancel_at_period_end = ?, paid_until = ?, updated_at = ?
          WHERE user_id = ? AND lock_id = ? AND lock_until > ?`,
          )
          .bind(
            state.id,
            state.status,
            state.currency,
            state.interval,
            state.end,
            Number(state.cancel),
            state.paidUntil,
            timestamp,
            ...fence,
          ),
        db
          .prepare(
            `INSERT INTO account_plans (user_id, premium_until, updated_at)
          SELECT user_id, ?, ? FROM billing_accounts WHERE user_id = ? AND lock_id = ? AND lock_until > ?
          ON CONFLICT(user_id) DO UPDATE SET premium_until = excluded.premium_until, updated_at = excluded.updated_at`,
          )
          .bind(state.paidUntil, timestamp, ...fence),
      ];
      if (eventId)
        statements.push(
          db
            .prepare(
              `INSERT INTO billing_events (event_id, processed_at)
        SELECT ?, ? WHERE EXISTS (${valid}) ON CONFLICT(event_id) DO NOTHING`,
            )
            .bind(eventId, timestamp, ...fence),
        );
      const results = await db.batch(statements);
      if (results[1].meta.changes !== 1) throw unavailable();
    } finally {
      for (const host of hosts.results) invalidateDomainLookup(db, host.hostname);
    }
  }
  async function reconcile(row: Account, eventId?: string) {
    const subs = await subscriptions(row);
    const state = await snapshot(row, subs);
    await project(row, state, eventId);
    return { state, subs };
  }
  function status(row: Account | null, listed: BillingPrice[]): BillingStatus {
    return {
      available,
      prices: listed,
      hasCustomer: !!row?.customer_id,
      ...(row?.subscription_status && row.currency && row.interval
        ? {
            subscription: {
              status: row.subscription_status,
              currency: row.currency,
              interval: row.interval,
              cancelAtPeriodEnd: !!row.cancel_at_period_end,
              currentPeriodEnd: row.current_period_end,
            },
          }
        : {}),
    };
  }
  async function get(userId: string): Promise<BillingStatus> {
    if (!available) return { available: false, prices: [], hasCustomer: false };
    await limit(userId);
    let row = await account(userId);
    if (row?.customer_id) {
      await locked(userId, async (current) => {
        await reconcile(current);
      });
      row = await account(userId);
    }
    return status(row, await prices());
  }
  async function checkout(
    userId: string,
    choice: { currency: BillingCurrency; interval: BillingInterval },
  ) {
    requireAvailable();
    const chosen = configured.find(
      (price) => price.currency === choice?.currency && price.interval === choice?.interval,
    );
    if (!chosen) throw new AppError('Choose an available currency and billing interval.', 400);
    await limit(userId, true);
    await prices();
    return locked(userId, async (row) => {
      if (!row.customer_id) {
        await assertLease(row);
        const customer = await api<{ id: string; livemode: boolean }>(
          'customers',
          new URLSearchParams(),
          `wya-customer-${await digestKey(userId)}`,
        );
        if (!stripeId(customer.id, 'cus') || customer.livemode !== live) throw unavailable();
        await update(row, 'customer_id = ?', [customer.id]);
        row.customer_id = customer.id;
      }
      const { subs } = await reconcile(row);
      if (subs.some((sub) => !['canceled', 'incomplete_expired'].includes(sub.status))) {
        throw new AppError(
          'You already have a subscription. Manage it in the billing portal.',
          409,
        );
      }
      if (row.checkout_id) {
        const current = await api<Session>(
          `checkout/sessions/${encodeURIComponent(row.checkout_id)}`,
        );
        if (current.customer !== row.customer_id) throw unavailable();
        if (!['open', 'expired', 'complete'].includes(current.status)) throw unavailable();
        if (
          current.status === 'complete' &&
          !subs.some(
            (sub) =>
              sub.id === current.subscription &&
              ['canceled', 'incomplete_expired'].includes(sub.status),
          )
        )
          throw new AppError('Your payment is being confirmed. Refresh billing shortly.', 409);
        if (
          current.status === 'open' &&
          row.checkout_price_id === chosen.id &&
          secondsMs(current.expires_at) > now()
        )
          return { url: redirectUrl(current.url, 'checkout.stripe.com') };
        if (current.status === 'open') {
          await assertLease(row);
          await api(
            `checkout/sessions/${encodeURIComponent(current.id)}/expire`,
            new URLSearchParams(),
            `wya-expire-${current.id}`,
          );
        }
        row.checkout_key = null;
      }
      // Persist the exact attempt before POST: a lost response reuses its idempotency key.
      if (
        row.checkout_key &&
        row.checkout_price_id !== chosen.id &&
        row.checkout_expires_at > now()
      ) {
        throw new AppError('A checkout is being prepared. Retry the original option shortly.', 409);
      }
      if (!row.checkout_key || row.checkout_expires_at <= now()) {
        row.checkout_key = crypto.randomUUID();
        row.checkout_expires_at = (Math.floor(now() / 1000) + 3600) * 1000;
        await update(
          row,
          'checkout_key = ?, checkout_price_id = ?, checkout_expires_at = ?, checkout_id = NULL, checkout_url = NULL',
          [row.checkout_key, chosen.id, row.checkout_expires_at],
        );
      }
      await assertLease(row);
      const session = await api<Session>(
        'checkout/sessions',
        new URLSearchParams({
          mode: 'subscription',
          customer: row.customer_id,
          'line_items[0][price]': chosen.id,
          'line_items[0][quantity]': '1',
          success_url: returnUrl('?checkout=success'),
          cancel_url: returnUrl('?checkout=cancel'),
          expires_at: String(row.checkout_expires_at / 1000),
        }),
        `wya-checkout-${row.checkout_key}`,
      );
      if (!stripeId(session.id, 'cs') || session.customer !== row.customer_id) throw unavailable();
      const url = redirectUrl(session.url, 'checkout.stripe.com');
      await update(row, 'checkout_id = ?, checkout_url = ?', [session.id, url]);
      return { url };
    });
  }
  async function portal(userId: string) {
    requireAvailable();
    await limit(userId, true);
    return locked(userId, async (row) => {
      if (!row.customer_id) throw new AppError('No billing account exists yet.', 404);
      await assertLease(row);
      const result = await api<{ url: string }>(
        'billing_portal/sessions',
        new URLSearchParams({ customer: row.customer_id, return_url: returnUrl() }),
      );
      return { url: redirectUrl(result.url, 'billing.stripe.com') };
    });
  }
  async function webhook(rawBody: string, signature: string) {
    requireAvailable();
    if (!(await verifyBillingSignature(rawBody, signature, config.webhookSecret!, now())))
      throw new AppError('Invalid webhook signature.', 400);
    let event: {
      id: string;
      type: string;
      livemode: boolean;
      data: { object: { customer?: unknown } };
    };
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new AppError('Invalid webhook body.', 400);
    }
    if (
      !event ||
      !stripeId(event.id, 'evt') ||
      typeof event.type !== 'string' ||
      event.livemode !== live
    )
      throw new AppError('Invalid webhook event.', 400);
    if (!EVENTS.has(event.type)) return { received: true as const };
    const customer = event.data?.object?.customer;
    if (!stripeId(customer, 'cus')) return { received: true as const };
    const row = await db
      .prepare('SELECT * FROM billing_accounts WHERE customer_id = ?')
      .bind(customer)
      .first<Account>();
    if (!row) return { received: true as const }; // No identity inference from metadata or email.
    await locked(row.user_id, async (current) => {
      if (
        await db
          .prepare('SELECT event_id FROM billing_events WHERE event_id = ?')
          .bind(event.id)
          .first()
      )
        return;
      if (current.customer_id !== customer) throw unavailable();
      await reconcile(current, event.id);
    });
    // Thirty days of durable duplicate protection; older deliveries still reconcile canonical state.
    await db
      .prepare(
        'DELETE FROM billing_events WHERE event_id IN (SELECT event_id FROM billing_events WHERE processed_at < ? ORDER BY processed_at LIMIT 100)',
      )
      .bind(now() - 30 * DAY_MS)
      .run();
    return { received: true as const };
  }
  return { get, checkout, portal, webhook };
}
