import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/contact/route.ts';

test('retired Support endpoint never inspects a message or attempts network delivery', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Retired endpoint attempted network delivery');
  });
  const unreadableRequest = new Proxy(
    {},
    {
      get() {
        throw new Error('Retired endpoint inspected the request');
      },
    },
  );
  const response = await Reflect.apply(POST, undefined, [unreadableRequest]);

  assert.equal(response.status, 410);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    error: 'Support is now available by email. Please email support@wya.im.',
  });
  assert.equal(network.mock.callCount(), 0);
});
