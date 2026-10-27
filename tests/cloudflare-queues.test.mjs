import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCloudflareQueues, requiredQueueNames } from '../scripts/cloudflare-queues.mjs';

const accountId = 'a'.repeat(32);
const apiToken = 'unit-test-token-do-not-echo';
const mainQueue = 'wya-domain-maintenance';
const deadQueue = 'wya-domain-maintenance-dead';
const config = {
  account_id: accountId,
  queues: {
    producers: [{ binding: 'DOMAIN_MAINTENANCE', queue: mainQueue }],
    consumers: [{ queue: mainQueue, dead_letter_queue: deadQueue }],
  },
};

function queueResponse(names, totalPages = 1) {
  return Response.json({
    success: true,
    result: names.map((queue_name) => ({ queue_name })),
    result_info: { total_pages: totalPages },
  });
}

function assertLookup(input, init) {
  const url = new URL(input);
  assert.equal(url.origin, 'https://api.cloudflare.com');
  assert.equal(url.pathname, `/client/v4/accounts/${accountId}/queues`);
  assert.equal(init?.method ?? 'GET', 'GET');
  assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${apiToken}`);
  assert.equal(init?.body, undefined);
  assert.equal(url.href.includes(apiToken), false);
  return url;
}

test('queue preflight includes producers, consumers, and dead-letter queues once', () => {
  assert.deepEqual(requiredQueueNames(config), [mainQueue, deadQueue]);
  assert.deepEqual(
    requiredQueueNames({
      queues: {
        producers: [{ queue: 'z-producer' }, { queue: 'z-producer' }],
        consumers: [
          { queue: 'm-consumer', dead_letter_queue: 'a-dead' },
          { queue: 'm-consumer', dead_letter_queue: 'a-dead' },
        ],
      },
    }),
    ['a-dead', 'm-consumer', 'z-producer'],
  );
});

test('queue preflight makes no requests or token requirement when queues are disabled', async () => {
  for (const disabled of [{}, { queues: { producers: [], consumers: [] } }]) {
    assert.deepEqual(requiredQueueNames(disabled), []);
    assert.deepEqual(
      await checkCloudflareQueues(disabled, {
        fetcher: () => assert.fail('Disabled queues must not contact Cloudflare.'),
      }),
      [],
    );
  }
});

test('queue preflight verifies both existing queues using authenticated read-only requests', async () => {
  const requests = [];
  const result = await checkCloudflareQueues(config, {
    apiToken,
    fetcher: async (input, init) => {
      const url = assertLookup(input, init);
      assert.equal(url.searchParams.get('page'), '1');
      const name = url.searchParams.get('name');
      requests.push(name);
      return queueResponse([name]);
    },
  });
  assert.deepEqual(result, [mainQueue, deadQueue]);
  assert.deepEqual(requests.sort(), [mainQueue, deadQueue]);
});

for (const missing of [[mainQueue], [deadQueue], [mainQueue, deadQueue]]) {
  test(`queue preflight reports missing ${missing.join(' and ')} with creation commands`, async () => {
    await assert.rejects(
      checkCloudflareQueues(config, {
        apiToken,
        fetcher: async (input, init) => {
          const name = assertLookup(input, init).searchParams.get('name');
          return queueResponse(missing.includes(name) ? [] : [name]);
        },
      }),
      (error) => {
        for (const name of missing) {
          assert.ok(error.message.includes(`wrangler queues create ${name}`));
        }
        assert.equal(error.message.includes(apiToken), false);
        return true;
      },
    );
  });
}

test('queue preflight rejects a prefix match instead of accepting a different queue', async () => {
  await assert.rejects(
    checkCloudflareQueues(config, {
      apiToken,
      fetcher: async (input, init) => {
        const name = assertLookup(input, init).searchParams.get('name');
        return queueResponse([`${name}-unrelated`]);
      },
    }),
    (error) => {
      assert.ok(error.message.includes(`wrangler queues create ${mainQueue}`));
      assert.ok(error.message.includes(`wrangler queues create ${deadQueue}`));
      return true;
    },
  );
});

test('queue preflight follows pagination until it finds the exact queue', async () => {
  const pages = [];
  const result = await checkCloudflareQueues(config, {
    apiToken,
    fetcher: async (input, init) => {
      const url = assertLookup(input, init);
      const name = url.searchParams.get('name');
      const page = Number(url.searchParams.get('page'));
      pages.push(`${name}:${page}`);
      assert.ok(page === 1 || page === 2);
      return queueResponse(page === 1 ? [`${name}-prefix-match`] : [name], 2);
    },
  });
  assert.deepEqual(result, [mainQueue, deadQueue]);
  assert.deepEqual(pages.sort(), [
    `${deadQueue}:1`,
    `${deadQueue}:2`,
    `${mainQueue}:1`,
    `${mainQueue}:2`,
  ]);
});

const providerDetail = `private-provider-diagnostic ${apiToken}`;
for (const failure of [
  {
    name: 'HTTP authorization failure',
    fetcher: async () =>
      Response.json({ success: false, errors: [{ message: providerDetail }] }, { status: 403 }),
  },
  {
    name: 'provider failure envelope',
    fetcher: async () =>
      Response.json({ success: false, result: [], errors: [{ message: providerDetail }] }),
  },
  {
    name: 'malformed result',
    fetcher: async () => Response.json({ success: true, result: { message: providerDetail } }),
  },
  {
    name: 'invalid JSON',
    fetcher: async () => new Response(providerDetail, { status: 200 }),
  },
  {
    name: 'network failure',
    fetcher: async () => {
      throw new Error(providerDetail);
    },
  },
]) {
  test(`queue preflight sanitizes ${failure.name} without claiming queues are missing`, async () => {
    await assert.rejects(
      checkCloudflareQueues(config, { apiToken, fetcher: failure.fetcher }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.length > 0);
        assert.equal(error.message.includes(apiToken), false);
        assert.equal(error.message.includes('private-provider-diagnostic'), false);
        assert.equal(error.message.includes('wrangler queues create'), false);
        return true;
      },
    );
  });
}
