import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainConnectionView } from '../lib/domain-connection-view.ts';
import {
  DOMAIN_STATUS_MAX_AGE,
  domainStatus,
  type DomainRow,
  type DomainStatus,
} from '../lib/custom-domains.ts';

const checkedAt = 1_800_000_000_000;
function domain(overrides: Partial<DomainStatus> = {}): DomainStatus {
  return {
    hostname: 'example.com',
    status: 'ownership',
    redirect: false,
    checkedAt: 0,
    records: [{ type: 'TXT', name: '_wya.example.com', value: 'wya-test-token' }],
    checks: { ownership: 'pending', certificate: 'pending', routing: 'pending' },
    ...overrides,
  };
}

test('a newly added domain has an explicit first step without claiming a failed check', () => {
  const view = domainConnectionView(domain());
  assert.equal(view.step, 0);
  assert.deepEqual(view.completed, [false, false, false]);
  assert.equal(view.title, 'Add your DNS records');
  assert.doesNotMatch(view.description, /last check|could not confirm/i);
});

test('missing ownership after prior verification returns to the TXT step despite an active certificate', () => {
  const view = domainConnectionView(
    domain({
      status: 'pending',
      checkedAt,
      checks: { ownership: 'pending', certificate: 'active', routing: 'pending' },
    }),
  );
  assert.equal(view.state, 'warning');
  assert.equal(view.step, 0);
  assert.deepEqual(view.completed, [false, false, false]);
  assert.match(view.description, /ownership TXT record/);
});

test('verified ownership advances to HTTPS and exposes additional validation as the next action', () => {
  const view = domainConnectionView(
    domain({
      status: 'pending',
      checkedAt,
      checks: { ownership: 'verified', certificate: 'pending', routing: 'pending' },
      records: [
        { type: 'TXT', name: '_wya.example.com', value: 'wya-test-token' },
        { type: 'TXT', name: '_acme-challenge.example.com', value: 'certificate-test-token' },
      ],
    }),
  );
  assert.equal(view.state, 'waiting');
  assert.equal(view.step, 1);
  assert.deepEqual(view.completed, [true, false, false]);
  assert.match(view.description, /additional verification records/);
  assert.doesNotMatch(view.description, /ownership TXT record/);
});

test('active HTTPS does not mark an unconfirmed address connection complete', () => {
  const view = domainConnectionView(
    domain({
      status: 'pending',
      checkedAt,
      checks: { ownership: 'verified', certificate: 'active', routing: 'pending' },
    }),
  );
  assert.equal(view.state, 'waiting');
  assert.equal(view.step, 2);
  assert.deepEqual(view.completed, [true, true, false]);
  assert.doesNotMatch(view.description, /incorrect|invalid|wrong/i);
});

test('expired verification cannot display a fully completed connection', () => {
  const row: DomainRow = {
    space_id: 'space-one',
    hostname: 'example.com',
    verification_token: 'wya-test-token',
    verified_at: checkedAt,
    provider_id: 'provider-one',
    hostname_status: 'active',
    ssl_status: 'active',
    dns_ready: 1,
    records: '[]',
    redirect: 0,
    removing: 0,
    checked_at: checkedAt,
  };
  const view = domainConnectionView(domainStatus(row, checkedAt + DOMAIN_STATUS_MAX_AGE + 1));
  assert.equal(view.state, 'waiting');
  assert.equal(view.step, 2);
  assert.deepEqual(view.completed, [true, true, false]);
});

test('legacy pending responses request fresh status without diagnosing an unobserved TXT failure', () => {
  for (const lastCheck of [0, checkedAt]) {
    const view = domainConnectionView(
      domain({ status: 'pending', checks: undefined, checkedAt: lastCheck }),
    );
    assert.equal(view.state, 'waiting');
    assert.deepEqual(view.completed, [false, false, false]);
    assert.doesNotMatch(view.description, /could not confirm your ownership|TXT record/);
    assert.match(view.description, /check|refresh/i);
  }
});

test('active responses consistently show every step complete, including older APIs', () => {
  for (const checks of [
    undefined,
    { ownership: 'verified', certificate: 'active', routing: 'verified' } as const,
    { ownership: 'pending', certificate: 'pending', routing: 'pending' } as const,
  ]) {
    const view = domainConnectionView(domain({ status: 'active', checkedAt, checks }));
    assert.equal(view.state, 'active');
    assert.deepEqual(view.completed, [true, true, true]);
  }
});

test('suspension and unfinished disconnection override setup instructions', () => {
  const suspended = domainConnectionView(domain({ status: 'suspended' }));
  assert.equal(suspended.badge, 'Premium required');
  assert.match(suspended.description, /Premium/);
  assert.doesNotMatch(suspended.description, /Add.*DNS/);
  const disconnecting = domainConnectionView(domain({ status: 'removing' }));
  assert.equal(disconnecting.badge, 'Disconnecting');
  assert.match(disconnecting.description, /Routing is disabled/);
  assert.match(disconnecting.description, /Retry/);
});
