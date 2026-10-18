import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionSchema,
  applyAction,
  normalizeHandle,
  normalizeDestination,
  type ProfileData,
} from '../lib/model.ts';
const base: ProfileData = { name: 'Alex', bio: 'Hello', theme: 'lilac', links: [] };
test('handles accept social username characters, normalize case, and reject reserved routes', () => {
  assert.equal(normalizeHandle('@Alex.Castro_1'), 'alex.castro_1');
  for (const value of [
    'api',
    'Dashboard',
    '../alex',
    '.alex',
    'alex.',
    '..',
    'two names',
    '_alex',
    'a'.repeat(40),
  ])
    assert.throws(() => normalizeHandle(value));
});
test('social usernames become URLs; local destinations are allowed and unsafe schemes rejected', () => {
  assert.equal(normalizeDestination('github', '@alex-castro'), 'https://github.com/alex-castro');
  assert.equal(
    normalizeDestination('instagram', 'alex.castro'),
    'https://www.instagram.com/alex.castro',
  );
  assert.equal(
    normalizeDestination('discord', 'https://discord.gg/hello'),
    'https://discord.gg/hello',
  );
  for (const value of ['https://wya.im/', 'https://wya.im/alex', 'https://wya.im/a/b'])
    assert.equal(normalizeDestination('custom', value), value);
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,x',
    'https://user:pass@example.com',
    'not a URL',
  ])
    assert.throws(() => normalizeDestination('custom', value));
  assert.throws(() => normalizeDestination('github', 'name/path'));
});
test('updates preserve omitted fields and do not mutate the existing snapshot', () => {
  const action = actionSchema.parse({
    action: 'update_profile',
    expectedVersion: 1,
    bio: 'Updated',
  });
  const next = applyAction(base, action).data;
  assert.equal(next.name, 'Alex');
  assert.equal(next.bio, 'Updated');
  assert.equal(base.bio, 'Hello');
});
test('add, replace, hide, reorder, and delete have deterministic behavior', () => {
  const add = (slug: string) =>
    actionSchema.parse({
      action: 'upsert_link',
      expectedVersion: 1,
      slug,
      label: slug,
      destination: 'https://example.com',
      platform: 'website',
    });
  for (const invalid of ['.', '..', '.link', 'link.', 'a/b', 'a%2Eb'])
    assert.throws(() => add(invalid));
  let p = applyAction(base, add(' My.Portfolio ')).data;
  p = applyAction(p, add('two')).data;
  const hidden = actionSchema.parse({
    ...add(' My.Portfolio '),
    visible: false,
    destination: 'https://example.org',
  });
  p = applyAction(p, hidden).data;
  assert.equal(p.links.length, 2);
  assert.equal(p.links[0].visible, false);
  assert.equal(p.links[0].url, 'https://example.org/');
  p = applyAction(
    p,
    actionSchema.parse({
      action: 'reorder_links',
      expectedVersion: 3,
      slugs: ['two', 'my.portfolio'],
    }),
  ).data;
  assert.deepEqual(
    p.links.map((l) => l.slug),
    ['two', 'my.portfolio'],
  );
  assert.throws(() =>
    applyAction(
      p,
      actionSchema.parse({
        action: 'reorder_links',
        expectedVersion: 3,
        slugs: ['my.portfolio', 'my.portfolio'],
      }),
    ),
  );
  p = applyAction(
    p,
    actionSchema.parse({ action: 'delete_link', expectedVersion: 4, slug: 'my.portfolio' }),
  ).data;
  assert.equal(p.links.length, 1);
  assert.equal(base.links.length, 0);
});
test('actions reject owner overrides, missing concurrency versions, and unsupported fields', () => {
  assert.equal(actionSchema.safeParse({ action: 'update_profile', name: 'X' }).success, false);
  assert.equal(
    actionSchema.safeParse({ action: 'update_profile', expectedVersion: 1, userId: 'someone-else' })
      .success,
    false,
  );
  assert.equal(
    actionSchema.safeParse({
      action: 'create_profile',
      handle: 'alex',
      name: 'Alex',
      verified: true,
    }).success,
    false,
  );
});

test('slug edits preserve position and icon, reject collisions, and require the original link to exist', () => {
  const input = {
    action: 'upsert_link',
    expectedVersion: 1,
    slug: 'code',
    label: 'Code',
    destination: 'https://example.com/',
    platform: 'website',
    icon: 'rocket',
  };
  let profile = applyAction(base, actionSchema.parse(input)).data;
  profile = applyAction(profile, actionSchema.parse({ ...input, slug: 'contact' })).data;
  const renamed = applyAction(
    profile,
    actionSchema.parse({
      ...input,
      originalSlug: ' CODE ',
      slug: 'My.Work',
      label: 'My work',
      icon: undefined,
    }),
  );
  assert.deepEqual(
    renamed.data.links.map((link) => link.slug),
    ['my.work', 'contact'],
  );
  assert.equal(renamed.data.links[0].icon, 'rocket');
  assert.equal(renamed.data.links[0].label, 'My work');
  assert.equal(renamed.reason, 'Changed /code to /my.work');
  assert.equal(profile.links[0].slug, 'code');
  assert.throws(
    () =>
      applyAction(profile, actionSchema.parse({ ...input, originalSlug: 'code', slug: 'CONTACT' })),
    /already used/,
  );
  assert.throws(
    () =>
      applyAction(
        profile,
        actionSchema.parse({ ...input, originalSlug: 'missing', slug: 'contact' }),
      ),
    { status: 404 },
  );
  const relabeled = applyAction(
    profile,
    actionSchema.parse({ ...input, originalSlug: 'code', label: 'Source code' }),
  ).data;
  assert.equal(relabeled.links[0].slug, 'code');
  assert.equal(relabeled.links[0].label, 'Source code');
});

test('link icons survive edits, reordering, and snapshots; null resets the preset icon', () => {
  const add = actionSchema.parse({
    action: 'upsert_link',
    expectedVersion: 1,
    slug: 'videos',
    label: 'Watch my videos',
    destination: 'https://www.youtube.com/@alex',
    platform: 'youtube',
    icon: 'rocket',
  });
  const created = applyAction(base, add).data;
  assert.equal(created.links[0].icon, 'rocket');
  assert.equal(add.action, 'upsert_link');
  if (add.action !== 'upsert_link') throw new Error('Expected link action');
  const { icon: _icon, ...withoutIcon } = add;
  void _icon;
  const edited = applyAction(
    created,
    actionSchema.parse({ ...withoutIcon, label: 'New videos' }),
  ).data;
  assert.equal(edited.links[0].icon, 'rocket');
  assert.equal(created.links[0].label, 'Watch my videos');
  const reordered = applyAction(
    edited,
    actionSchema.parse({ action: 'reorder_links', expectedVersion: 2, slugs: ['videos'] }),
  ).data;
  assert.equal(reordered.links[0].icon, 'rocket');
  const reset = applyAction(edited, actionSchema.parse({ ...withoutIcon, icon: null })).data;
  assert.equal(reset.links[0].icon, undefined);
  assert.equal(JSON.parse(JSON.stringify(created)).links[0].icon, 'rocket');
  for (const icon of ['unrecognized', '<svg onload=alert(1)>', 'https://example.com/icon.svg']) {
    assert.equal(actionSchema.safeParse({ ...add, icon }).success, false);
  }
  const legacy = applyAction(base, actionSchema.parse(withoutIcon)).data;
  assert.equal(legacy.links[0].icon, undefined);
});

test('all link presets accept safe URLs and keep the existing URL protections', async () => {
  const { platforms, linkPresets, iconIds } = await import('../lib/link-options.ts');
  for (const platform of platforms) {
    assert.ok(iconIds.includes(linkPresets[platform].icon));
    const parsed = actionSchema.parse({
      action: 'upsert_link',
      expectedVersion: 1,
      slug: 'my-link',
      label: linkPresets[platform].label,
      destination: platform === 'email' ? 'hello@example.com' : 'https://example.com/profile',
      platform,
    });
    assert.equal(
      applyAction(base, parsed).data.links[0].url,
      platform === 'email' ? 'mailto:hello@example.com' : 'https://example.com/profile',
    );
    for (const destination of [
      'javascript:alert(1)',
      'data:text/html,x',
      'https://user:secret@example.com',
    ]) {
      assert.throws(() => applyAction(base, actionSchema.parse({ ...parsed, destination })));
    }
  }
});
