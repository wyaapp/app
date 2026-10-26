import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  createBillingService,
  verifyBillingSignature,
  type BillingConfig,
} from '../lib/billing-service.ts';

const config: BillingConfig = {
  hostingMode: 'hosted',
  secretKey: 'sk_test_unit_only',
  webhookSecret: 'whsec_unit_only',
  origin: 'https://wya.im',
  prices: {
    usd: { month: 'price_usd_month' },
    brl: { month: 'price_brl_month' },
  },
};
const base = 1_800_000_000_000;
function price(id = 'price_usd_month') {
  const [, currency, interval] = id.split('_');
  return {
    id,
    active: true,
    type: 'recurring',
    currency,
    unit_amount: currency === 'brl' ? 999 : 299,
    billing_scheme: 'per_unit',
    transform_quantity: null as { divide_by: number; round: string } | null,
    recurring: { interval, interval_count: 1, usage_type: 'licensed' },
    livemode: false,
  };
}
function subscription(
  options: {
    id?: string;
    status?: string;
    end?: number;
    paid?: boolean;
    customer?: string;
    priceId?: string;
    cancel?: boolean;
  } = {},
) {
  const id = options.id ?? 'sub_paid';
  const customer = options.customer ?? 'cus_owner';
  const itemPrice = price(options.priceId);
  const end = options.end ?? base + 30 * 86_400_000;
  return {
    id,
    customer,
    status: options.status ?? 'active',
    cancel_at_period_end: options.cancel ?? false,
    livemode: false,
    items: {
      has_more: false,
      data: [
        {
          price: itemPrice,
          quantity: 1,
          current_period_start: base / 1000,
          current_period_end: end / 1000,
        },
      ],
    },
    latest_invoice: {
      id: 'in_paid',
      customer,
      status: options.paid === false ? 'open' : 'paid',
      paid: options.paid !== false,
      lines: {
        has_more: false,
        data: [
          {
            pricing: { price_details: { price: itemPrice.id } },
            parent: { subscription_item_details: { subscription: id, proration: false } },
            period: { start: base / 1000, end: end / 1000 },
          },
        ],
      },
    },
  };
}
async function signature(raw: string, time = base, secret = config.webhookSecret!) {
  const timestamp = Math.floor(time / 1000);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`)),
  );
  return `t=${timestamp},v1=${Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('')}`;
}
function fixture(overrides: Partial<BillingConfig> = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE spaces (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, handle TEXT);');
  sqlite.exec(
    'CREATE TABLE space_revisions (id TEXT PRIMARY KEY, space_id TEXT, version INTEGER);',
  );
  sqlite.exec('CREATE TRIGGER spaces_limit BEFORE INSERT ON spaces BEGIN SELECT 1; END;');
  for (const file of [
    '0005_security_limits',
    '0008_space_domains',
    '0014_domain_maintenance',
    '0015_hosted_plans',
    '0016_stripe_billing',
  ])
    sqlite.exec(readFileSync(`drizzle/${file}.sql`, 'utf8'));
  sqlite.exec(
    "INSERT INTO spaces VALUES ('space-owner','owner','owner'),('space-other','other','other')",
  );
  sqlite
    .prepare(
      `INSERT INTO space_domains (space_id, hostname, verification_token, verified_at, hostname_status, dns_ready, created_at, next_check_at)
    VALUES ('space-owner', 'owner.example.com', 'keep-token', ?, 'active', 1, ?, ?)`,
    )
    .run(base - 10_000, base - 20_000, base + 20_000);
  let clock = base;
  let failBatch = false;
  let beforeAll: ((sql: string) => Promise<void>) | null = null;
  const db = {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const query = {
        bind(...args: SQLInputValue[]) {
          values = args;
          return query;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) ?? null;
        },
        async all() {
          await beforeAll?.(sql);
          return { results: sqlite.prepare(sql).all(...values) };
        },
        async run() {
          return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
        },
      };
      return query;
    },
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
          if (failBatch) throw new Error('database interrupted');
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  const calls: Array<{ path: string; method: string; body: URLSearchParams; key: string | null }> =
    [];
  const sessions = new Map<
    string,
    {
      id: string;
      customer: string;
      status: string;
      url: string;
      expires_at: number;
      subscription?: string;
    }
  >();
  const attempts = new Map<string, unknown>();
  let subs: ReturnType<typeof subscription>[] = [];
  let interceptor: ((path: string) => Promise<Response | void>) | null = null;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.stripe.com');
    assert.equal(init?.redirect, 'manual');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Stripe-Version'), '2025-06-30.basil');
    assert.equal(headers.get('authorization'), 'Bearer sk_test_unit_only');
    const body = new URLSearchParams(init?.body as URLSearchParams);
    const path = url.pathname.slice(4);
    const call = { path, method: init?.method ?? 'GET', body, key: headers.get('Idempotency-Key') };
    calls.push(call);
    const intercepted = await interceptor?.(path);
    if (intercepted) return intercepted;
    if (path.startsWith('prices/')) return Response.json(price(path.slice(7)));
    if (path === 'subscriptions') {
      assert.equal(url.searchParams.get('customer'), 'cus_owner');
      return Response.json({ data: structuredClone(subs), has_more: false });
    }
    if (path === 'customers') return Response.json({ id: 'cus_owner', livemode: false });
    if (path === 'checkout/sessions') {
      if (attempts.has(call.key!)) return Response.json(attempts.get(call.key!));
      const id = `cs_test_${sessions.size + 1}`;
      const session = {
        id,
        customer: body.get('customer')!,
        status: 'open',
        url: `https://checkout.stripe.com/c/pay/${id}`,
        expires_at: Number(body.get('expires_at')),
      };
      sessions.set(id, session);
      attempts.set(call.key!, session);
      return Response.json(session);
    }
    if (path.startsWith('checkout/sessions/')) {
      const [, , id, action] = path.split('/');
      const session = sessions.get(id)!;
      if (action === 'expire') session.status = 'expired';
      return Response.json(session);
    }
    if (path === 'billing_portal/sessions')
      return Response.json({ url: 'https://billing.stripe.com/p/session/unit' });
    throw new Error(`Unexpected mocked Stripe route ${path}`);
  };
  const service = createBillingService(
    db,
    { ...config, ...overrides },
    { fetcher, now: () => clock, cachePrices: false },
  );
  function bindCustomer() {
    sqlite
      .prepare('INSERT INTO billing_accounts (user_id,customer_id,updated_at) VALUES (?,?,?)')
      .run('owner', 'cus_owner', clock);
  }
  function grant(until: number) {
    sqlite
      .prepare(
        'INSERT INTO account_plans VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET premium_until=excluded.premium_until',
      )
      .run('owner', until, clock);
  }
  function entitlement() {
    return sqlite.prepare('SELECT premium_until FROM account_plans WHERE user_id=?').get('owner')
      ?.premium_until;
  }
  async function event(
    id = 'evt_first',
    type = 'invoice.paid',
    extra: Record<string, unknown> = {},
  ) {
    const raw = JSON.stringify({
      id,
      type,
      livemode: false,
      data: { object: { customer: 'cus_owner', ...extra } },
    });
    return service.webhook(raw, await signature(raw, clock));
  }
  return {
    sqlite,
    db,
    service,
    calls,
    sessions,
    bindCustomer,
    grant,
    entitlement,
    event,
    setSubs(value: typeof subs) {
      subs = value;
    },
    setClock(value: number) {
      clock = value;
    },
    intercept(fn: typeof interceptor) {
      interceptor = fn;
    },
    beforeAll(fn: typeof beforeAll) {
      beforeAll = fn;
    },
    failBatch(value: boolean) {
      failBatch = value;
    },
  };
}

test('self-hosting and unconfigured hosted billing never call Stripe', async () => {
  for (const overrides of [{ hostingMode: 'self-hosted' as const }, { secretKey: undefined }]) {
    const f = fixture(overrides);
    assert.deepEqual(await f.service.get('owner'), {
      available: false,
      prices: [],
      hasCustomer: false,
    });
    await assert.rejects(
      f.service.checkout('owner', { currency: 'usd', interval: 'month' }),
      /unavailable/,
    );
    assert.equal(f.calls.length, 0);
  }
});
test('pricing enforces approved monthly amounts, currency and interval', async () => {
  const f = fixture();
  const data = await f.service.get('owner');
  assert.deepEqual(data.prices, [
    { currency: 'usd', interval: 'month', amount: 299 },
    { currency: 'brl', interval: 'month', amount: 999 },
  ]);
  for (const override of [
    { currency: 'eur' },
    { unit_amount: 298 },
    { unit_amount: 1000 },
    { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } },
    { recurring: { interval: 'month', interval_count: 2, usage_type: 'licensed' } },
  ]) {
    f.intercept(async (path) =>
      path.startsWith('prices/')
        ? Response.json({ ...price(path.slice(7)), ...override })
        : undefined,
    );
    await assert.rejects(f.service.get('owner'), /unavailable/);
    await assert.rejects(
      f.service.checkout('owner', { currency: 'usd', interval: 'month' }),
      /unavailable/,
    );
  }
  assert.equal(
    f.calls.some((call) => call.path === 'checkout/sessions'),
    false,
  );
});
test('metered, tiered and quantity-transformed prices cannot be purchased or grant Premium', async () => {
  for (const override of [
    { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } },
    { billing_scheme: 'tiered' },
    { transform_quantity: { divide_by: 100, round: 'up' } },
  ]) {
    const f = fixture();
    f.intercept(async (path) =>
      path.startsWith('prices/')
        ? Response.json({ ...price(path.slice(7)), ...override })
        : undefined,
    );
    await assert.rejects(f.service.get('owner'), /unavailable/);
    await assert.rejects(
      f.service.checkout('owner', { currency: 'usd', interval: 'month' }),
      /unavailable/,
    );
    assert.equal(
      f.calls.some((call) => call.path === 'checkout/sessions'),
      false,
    );

    // Entitlements inspect the subscription's canonical Price independently
    // of the checkout catalog and must reject the same billing models.
    f.bindCustomer();
    const sub = subscription();
    sub.items.data[0].price = { ...sub.items.data[0].price, ...override };
    f.setSubs([sub]);
    await f.event();
    assert.equal(f.entitlement(), 0);
  }
});
test('launch checkout refuses annual billing and requires both monthly prices', async () => {
  const f = fixture({
    prices: {
      usd: { month: 'price_usd_month', year: 'price_usd_year' },
      brl: { month: 'price_brl_month', year: 'price_brl_year' },
    },
  });
  await assert.rejects(
    f.service.checkout('owner', { currency: 'usd', interval: 'year' }),
    /available currency/,
  );
  await assert.rejects(
    f.service.checkout('owner', { currency: 'eur' as 'usd', interval: 'month' }),
    /available currency/,
  );
  assert.equal(f.calls.length, 0);
  const partial = fixture({ prices: { usd: { month: 'price_usd_month' }, brl: {} } });
  assert.equal((await partial.service.get('owner')).available, false);
  await assert.rejects(
    partial.service.checkout('owner', { currency: 'usd', interval: 'month' }),
    /unavailable/,
  );
  assert.equal(partial.calls.length, 0);
});
test('checkout binds only stored customer, server price and trusted return URLs; reuses an open session', async () => {
  const f = fixture();
  const result = await f.service.checkout('owner', { currency: 'brl', interval: 'month' });
  const again = await f.service.checkout('owner', { currency: 'brl', interval: 'month' });
  assert.deepEqual(result, again);
  const posts = f.calls.filter((call) => call.path === 'checkout/sessions');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.get('customer'), 'cus_owner');
  assert.equal(posts[0].body.get('line_items[0][price]'), 'price_brl_month');
  assert.equal(
    posts[0].body.get('success_url'),
    'https://wya.im/dashboard/billing?checkout=success',
  );
  assert.equal(posts[0].body.get('mode'), 'subscription');
  assert.equal(f.entitlement(), 0);
});
test('changing billing option expires the old checkout before creating another', async () => {
  const f = fixture();
  await f.service.checkout('owner', { currency: 'usd', interval: 'month' });
  await f.service.checkout('owner', { currency: 'brl', interval: 'month' });
  assert.equal(f.sessions.get('cs_test_1')?.status, 'expired');
  assert.equal(f.sessions.size, 2);
  const expires = f.calls.findIndex((call) => call.path.endsWith('/expire'));
  const second = f.calls.findLastIndex((call) => call.path === 'checkout/sessions');
  assert.ok(expires < second);
});
test('ambiguous Checkout failure retains exact idempotency key and parameters for retry', async () => {
  const f = fixture();
  let failures = 1;
  f.intercept(async (path) => {
    if (path === 'checkout/sessions' && failures-- > 0) throw new Error('connection lost');
  });
  await assert.rejects(
    f.service.checkout('owner', { currency: 'usd', interval: 'month' }),
    /unavailable/,
  );
  f.setClock(base + 2000);
  await f.service.checkout('owner', { currency: 'usd', interval: 'month' });
  const posts = f.calls.filter((call) => call.path === 'checkout/sessions');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].key, posts[1].key);
  assert.equal(posts[0].body.toString(), posts[1].body.toString());
});
test('an existing live subscription blocks duplicate checkout; portal cannot accept another customer', async () => {
  const f = fixture();
  f.bindCustomer();
  f.setSubs([subscription()]);
  await assert.rejects(
    f.service.checkout('owner', { currency: 'usd', interval: 'month' }),
    /already have a subscription/,
  );
  assert.equal(f.calls.filter((call) => call.path === 'checkout/sessions').length, 0);
  assert.deepEqual(await f.service.portal('owner'), {
    url: 'https://billing.stripe.com/p/session/unit',
  });
  assert.equal(f.calls.at(-1)?.body.get('customer'), 'cus_owner');
  await assert.rejects(f.service.portal('other'), /No billing account/);
});
test('raw HMAC validation rejects tampering, old/future timestamps, malformed and duplicate timestamps', async () => {
  const raw = '{"x":1}';
  const signed = await signature(raw);
  assert.equal(await verifyBillingSignature(raw, signed, config.webhookSecret!, base), true);
  assert.equal(await verifyBillingSignature(raw + ' ', signed, config.webhookSecret!, base), false);
  assert.equal(
    await verifyBillingSignature(raw, signed, config.webhookSecret!, base + 301_000),
    false,
  );
  assert.equal(
    await verifyBillingSignature(raw, signed, config.webhookSecret!, base - 301_000),
    false,
  );
  assert.equal(
    await verifyBillingSignature(raw, signed + ',t=1', config.webhookSecret!, base),
    false,
  );
  assert.equal(
    await verifyBillingSignature(raw, 't=123,v1=no', config.webhookSecret!, base),
    false,
  );
  const rotated = signed.replace(',v1=', ',v1=' + '0'.repeat(64) + ',v1=');
  assert.equal(await verifyBillingSignature(raw, rotated, config.webhookSecret!, base), true);
});
test('unpaid Checkout and forged identity metadata never grant Premium', async () => {
  const f = fixture();
  f.bindCustomer();
  f.setSubs([subscription({ status: 'incomplete', paid: false })]);
  await f.event('evt_unpaid', 'checkout.session.completed', {
    payment_status: 'paid',
    metadata: { user_id: 'other' },
    client_reference_id: 'other',
  });
  assert.equal(f.entitlement(), 0);
  assert.equal(
    f.sqlite.prepare('SELECT * FROM account_plans WHERE user_id=?').get('other'),
    undefined,
  );
  const before = f.calls.length;
  await f.event('evt_unknown', 'invoice.paid', {
    customer: 'cus_unknown',
    metadata: { user_id: 'owner' },
  });
  assert.equal(f.calls.length, before);
});
test('paid invoice grants only its covered period, stores ms, and forces domain revalidation atomically', async () => {
  const f = fixture();
  f.bindCustomer();
  const sub = subscription();
  const paidEnd = base + 12 * 86_400_000;
  sub.latest_invoice.lines.data[0].period.end = paidEnd / 1000;
  f.setSubs([sub]);
  await f.event();
  assert.equal(f.entitlement(), paidEnd);
  const domain = f.sqlite.prepare('SELECT * FROM space_domains').get()!;
  assert.equal(domain.dns_ready, 0);
  assert.equal(domain.hostname_status, 'pending');
  assert.equal(domain.next_check_at, 0);
  assert.equal(domain.verification_token, 'keep-token');
  assert.equal(domain.verified_at, base - 10_000);
  const status = await f.service.get('owner');
  assert.equal(status.subscription?.currentPeriodEnd, base + 30 * 86_400_000);
});
test('ordinary paid renewal preserves current routing; failed renewal cannot extend paid expiry', async () => {
  const f = fixture();
  f.bindCustomer();
  f.grant(base + 10_000);
  f.setSubs([subscription()]);
  await f.event();
  assert.equal(f.sqlite.prepare('SELECT dns_ready FROM space_domains').get()?.dns_ready, 1);
  const paidEnd = f.entitlement();
  f.setSubs([subscription({ status: 'past_due', paid: false, end: base + 60 * 86_400_000 })]);
  await f.event('evt_failed', 'invoice.payment_failed');
  assert.equal(f.entitlement(), paidEnd);
});
test('duplicate events are durable no-ops; reordered old subscription events reconcile the new subscription', async () => {
  const f = fixture();
  f.bindCustomer();
  f.setSubs([subscription()]);
  await f.event();
  const calls = f.calls.length;
  await f.event();
  assert.equal(f.calls.length, calls);
  f.setSubs([
    subscription({ status: 'canceled' }),
    subscription({ id: 'sub_new', end: base + 60 * 86_400_000 }),
  ]);
  await f.event('evt_old_deleted', 'customer.subscription.deleted', { id: 'sub_paid' });
  assert.equal(f.entitlement(), base + 60 * 86_400_000);
  assert.equal(
    f.sqlite.prepare('SELECT subscription_id FROM billing_accounts').get()?.subscription_id,
    'sub_new',
  );
});
test('cancel-at-period-end preserves paid time; immediate cancellation revokes without deleting spaces', async () => {
  const f = fixture();
  f.bindCustomer();
  f.setSubs([subscription({ cancel: true })]);
  await f.event();
  assert.equal(f.entitlement(), base + 30 * 86_400_000);
  f.setSubs([subscription({ status: 'canceled', cancel: true })]);
  await f.event('evt_cancel', 'customer.subscription.deleted');
  assert.equal(f.entitlement(), 0);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM spaces').get()?.n, 2);
});
test('get repairs a missed paid webhook using canonical Stripe state', async () => {
  const f = fixture();
  f.bindCustomer();
  f.setSubs([subscription()]);
  assert.equal(f.entitlement(), undefined);
  await f.service.get('owner');
  assert.equal(f.entitlement(), base + 30 * 86_400_000);
});
test('unapproved products, wrong customers and prorations cannot create paid entitlement', async () => {
  const f = fixture();
  f.bindCustomer();
  const sub = subscription();
  sub.latest_invoice.lines.data[0].parent.subscription_item_details.proration = true;
  f.setSubs([sub]);
  await f.event();
  assert.equal(f.entitlement(), 0);
  f.setSubs([subscription({ priceId: 'price_usd_unknown' })]);
  await f.event('evt_wrong_price');
  assert.equal(f.entitlement(), 0);
  f.setSubs([subscription({ customer: 'cus_other' })]);
  await assert.rejects(f.event('evt_wrong_customer'), /unavailable/);
  assert.equal(f.entitlement(), 0);
});
test('transaction failure rolls back entitlement, routing changes and event ledger for safe retry', async () => {
  const f = fixture();
  f.bindCustomer();
  f.setSubs([subscription()]);
  f.failBatch(true);
  await assert.rejects(f.event(), /database interrupted/);
  assert.equal(f.entitlement(), undefined);
  assert.equal(f.sqlite.prepare('SELECT dns_ready FROM space_domains').get()?.dns_ready, 1);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM billing_events').get()?.n, 0);
  f.failBatch(false);
  await f.event();
  assert.equal(f.entitlement(), base + 30 * 86_400_000);
});
test('in-flight stale canonical fetch cannot overwrite a newer locked projection', async () => {
  const f = fixture();
  f.bindCustomer();
  let started!: () => void;
  const reached = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  f.intercept(async (path) => {
    if (path === 'subscriptions' && first) {
      first = false;
      started();
      await pending;
      return Response.json({ data: [subscription()], has_more: false });
    }
  });
  const old = f.event('evt_old');
  await reached;
  await assert.rejects(f.event('evt_busy'), /Billing is updating/);
  f.setClock(base + 91_000);
  f.setSubs([subscription({ status: 'canceled' })]);
  await f.event('evt_new');
  assert.equal(f.entitlement(), 0);
  release();
  await assert.rejects(old, /unavailable/);
  assert.equal(f.entitlement(), 0);
  assert.equal(
    f.sqlite.prepare('SELECT event_id FROM billing_events WHERE event_id=?').get('evt_old'),
    undefined,
  );
});
test('billing mutation and status rate limits bound Stripe work', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) await assert.rejects(f.service.portal('owner'), /No billing account/);
  await assert.rejects(f.service.portal('owner'), /Too many requests/);
  for (let i = 0; i < 20; i++) await f.service.get('owner');
  await assert.rejects(f.service.get('owner'), /Too many requests/);
});
test('Stripe errors and invalid redirects never leak response bodies or credentials', async () => {
  const f = fixture();
  f.bindCustomer();
  f.intercept(async () => new Response('sk_test_very_secret provider details', { status: 500 }));
  await assert.rejects(
    f.service.portal('owner'),
    (error) =>
      error instanceof Error &&
      error.message === 'Billing is temporarily unavailable. Please try again later.',
  );
  f.intercept(async (path) =>
    path === 'billing_portal/sessions'
      ? Response.json({ url: 'https://evil.example/steal' })
      : undefined,
  );
  await assert.rejects(f.service.portal('owner'), /unavailable/);
});

test('Stripe HTTP redirects are rejected without following or retrying with credentials', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const f = fixture();
    f.bindCustomer();
    f.intercept(
      async () =>
        new Response('sk_test_very_secret provider details', {
          status,
          headers: { Location: 'https://untrusted.example/collect' },
        }),
    );
    await assert.rejects(
      f.service.portal('owner'),
      (error) =>
        error instanceof Error &&
        error.message === 'Billing is temporarily unavailable. Please try again later.',
    );
    assert.equal(f.calls.length, 1);
  }
});

test('a canceled subscriber can buy again, but a completed unconfirmed payment cannot', async () => {
  const f = fixture();
  await f.service.checkout('owner', { currency: 'usd', interval: 'month' });
  const original = f.sessions.get('cs_test_1')!;
  original.status = 'complete';
  original.subscription = 'sub_paid';
  await assert.rejects(
    f.service.checkout('owner', { currency: 'usd', interval: 'month' }),
    /payment is being confirmed/,
  );
  f.setSubs([subscription({ status: 'canceled' })]);
  await f.service.checkout('owner', { currency: 'usd', interval: 'month' });
  assert.equal(f.sessions.size, 2);
});
test('a delayed hostname read cannot commit an expired lease or partially reset routing', async () => {
  const f = fixture();
  f.bindCustomer();
  f.setSubs([subscription()]);
  f.beforeAll(async (sql) => {
    if (sql.startsWith('SELECT hostname')) f.setClock(base + 91_000);
  });
  await assert.rejects(f.event(), /unavailable/);
  assert.equal(f.entitlement(), undefined);
  assert.equal(f.sqlite.prepare('SELECT dns_ready FROM space_domains').get()?.dns_ready, 1);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM billing_events').get()?.n, 0);
});
test('late ambiguous Checkout retries reuse the original attempt and never extend its expiry', async () => {
  const f = fixture();
  let failures = 1;
  f.intercept(async (path) => {
    if (path === 'checkout/sessions' && failures-- > 0) throw new Error('lost response');
  });
  await assert.rejects(
    f.service.checkout('owner', { currency: 'usd', interval: 'month' }),
    /unavailable/,
  );
  f.setClock(base + 31 * 60_000);
  await f.service.checkout('owner', { currency: 'usd', interval: 'month' });
  const posts = f.calls.filter((call) => call.path === 'checkout/sessions');
  assert.equal(posts[0].key, posts[1].key);
  assert.equal(posts[0].body.get('expires_at'), String(base / 1000 + 3600));
  assert.equal(posts[0].body.toString(), posts[1].body.toString());
});
test('a paginated subscription result fails closed rather than revoking from incomplete state', async () => {
  const f = fixture();
  f.bindCustomer();
  f.grant(base + 100_000);
  f.intercept(async (path) =>
    path === 'subscriptions' ? Response.json({ data: [], has_more: true }) : undefined,
  );
  await assert.rejects(f.event(), /unavailable/);
  assert.equal(f.entitlement(), base + 100_000);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM billing_events').get()?.n, 0);
});
test('ledger pruning is bounded and expired duplicates safely reconcile current state', async () => {
  const f = fixture();
  f.bindCustomer();
  f.setSubs([subscription()]);
  const insert = f.sqlite.prepare('INSERT INTO billing_events VALUES (?,?)');
  for (let i = 0; i < 150; i++) insert.run(`evt_old_${i}`, base - 31 * 86_400_000);
  await f.event();
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM billing_events').get()?.n, 51);
  f.setSubs([subscription({ status: 'canceled' })]);
  await f.event('evt_old_0');
  assert.equal(f.entitlement(), 0);
});

test('an unpaid live subscription is displayed before an older canceled annual subscription', async () => {
  const f = fixture();
  f.bindCustomer();
  f.setSubs([
    subscription({ status: 'canceled', end: base + 365 * 86_400_000 }),
    subscription({ id: 'sub_new', status: 'incomplete', paid: false }),
  ]);
  const data = await f.service.get('owner');
  assert.equal(data.subscription?.status, 'incomplete');
  assert.equal(f.entitlement(), 0);
});
