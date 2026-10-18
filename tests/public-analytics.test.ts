import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsAllowed,
  sanitizePageview,
  sanitizePublicEvent,
} from '../lib/public-analytics.ts';

test('analytics excludes local previews and honors privacy signals', () => {
  assert.equal(analyticsAllowed('wya.im', null), true);
  for (const host of ['localhost', '127.0.0.1', 'preview.wya.im', 'wya-im.workers.dev'])
    assert.equal(analyticsAllowed(host, null), false);
  assert.equal(analyticsAllowed('wya.im', '1'), false);
  assert.equal(analyticsAllowed('wya.im', 'yes'), false);
  assert.equal(analyticsAllowed('wya.im', null, true), false);
});

test('clicks only accept rendered item IDs and never send button text or destinations', () => {
  const scope = { path: '/alex', spaceKey: 'opaque-space', itemIds: ['game-id'] };
  const event = {
    uuid: 'event',
    event: 'wya_item_click',
    properties: {
      token: 'phc_test',
      wya_item_id: 'game-id',
      destination: 'mailto:private@example.com',
      label: 'Private',
      wya_space_id: 'forged-space',
    },
  };
  const result = sanitizePublicEvent(event, scope)!;
  assert.equal(result.properties.wya_space_id, 'opaque-space');
  assert.equal(result.properties.wya_item_id, 'game-id');
  assert.equal(result.properties.destination, undefined);
  assert.equal(result.properties.label, undefined);
  assert.equal(
    sanitizePublicEvent({ ...event, properties: { wya_item_id: 'not-rendered' } }, scope),
    null,
  );
  assert.equal(sanitizePublicEvent(event, null), null);
  assert.equal(sanitizePublicEvent(event, { path: '/' }), null);
});

test('pageview payload drops identity, referrers, query strings and SDK enrichment', () => {
  const input = {
    uuid: 'event-id',
    event: '$pageview',
    properties: {
      token: 'phc_test',
      distinct_id: '$posthog_cookieless',
      $cookieless_mode: true,
      $lib: 'web',
      $lib_version: 'test',
      $current_url: 'https://wya.im/alex?email=private@example.com#private',
      $referrer: 'https://example.com/private?token=secret',
      email: 'private@example.com',
      $initial_person_info: { email: 'private@example.com' },
      $session_id: 'session',
      $set: { email: 'private@example.com' },
      $device_id: 'device',
      arbitrary: 'private',
    },
    $set: { email: 'private@example.com' },
    $set_once: { name: 'Private' },
  };
  const output = sanitizePageview(input, '/alex')!;
  assert.deepEqual(output.properties, {
    token: 'phc_test',
    distinct_id: '$posthog_cookieless',
    $cookieless_mode: true,
    $lib: 'web',
    $lib_version: 'test',
    $process_person_profile: false,
    $current_url: 'https://wya.im/alex',
    $host: 'wya.im',
    $pathname: '/alex',
    page_kind: 'profile',
  });
  assert.equal(JSON.stringify(output).includes('private'), false);
  assert.equal(sanitizePageview(input, null), null);
  assert.equal(sanitizePageview({ ...input, event: '$autocapture' }, '/alex'), null);
  assert.equal(sanitizePageview({ ...input, event: '$identify' }, '/alex'), null);
  assert.equal(sanitizePageview(input, '/')!.properties.page_kind, 'home');
});
