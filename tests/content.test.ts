import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionSchema,
  applyAction,
  findVisibleLink,
  normalizeDestination,
  MAX_PROJECTS,
  type ProfileData,
  type Profile,
} from '../lib/model.ts';
import { emailLink, parseEmailLink } from '../lib/email-links.ts';
import { resolveLinkDestination } from '../lib/link-redirects.ts';
const base: ProfileData = { name: 'Alex', bio: '', theme: 'lilac', links: [] };
const change = (data: ProfileData, input: Record<string, unknown>) =>
  applyAction(data, actionSchema.parse({ expectedVersion: 1, ...input })).data;
const link = {
  action: 'upsert_link',
  slug: 'code',
  aliases: ['gh', 'source'],
  label: 'Code',
  destination: 'https://example.com/',
  platform: 'website',
};
const project = {
  action: 'upsert_project',
  slug: 'portfolio',
  label: 'My app',
  description: 'A useful project.',
  buttons: [
    { label: 'Demo', destination: 'https://example.com/demo' },
    { label: 'Source', destination: 'https://github.com/example/repo' },
  ],
  aliases: ['app'],
};
const profile = (data: ProfileData): Profile => ({
  ...data,
  id: 'space',
  handle: 'alex',
  aliases: ['old'],
  version: 1,
  updatedAt: '',
});

test('project icons persist across edits and renames, can be reset, and reject unknown icons', () => {
  let data = change(base, { ...project, icon: 'github' });
  assert.equal(data.links[0].icon, 'github');
  data = change(data, { ...project, originalSlug: 'portfolio', slug: 'renamed' });
  assert.equal(data.links[0].icon, 'github');
  data = change(data, { ...project, originalSlug: 'renamed', icon: 'rocket' });
  assert.equal(data.links[0].icon, 'rocket');
  data = change(data, { ...project, icon: null });
  assert.equal(data.links[0].icon, undefined);
  assert.throws(() => change(base, { ...project, icon: 'not-an-icon' }));
});

test('email links encode one address, subject and body; arbitrary headers and injection are rejected', () => {
  const url = emailLink('hello+work@example.com', 'Hello & welcome', 'Line one\nLine two');
  assert.deepEqual(parseEmailLink(url), {
    address: 'hello+work@example.com',
    subject: 'Hello & welcome',
    body: 'Line one\nLine two',
  });
  assert.equal(
    normalizeDestination('email', 'mailto:hello@example.com?subject=Hi'),
    'mailto:hello@example.com?subject=Hi',
  );
  for (const invalid of [
    'a@example.com,b@example.com',
    'not-an-email',
    'javascript:alert(1)',
    'https://example.com',
    'mailto:a@example.com?bcc=other@example.com',
    'mailto:a@example.com?subject=one&subject=two',
    'mailto:a@example.com?subject=Hi%0d%0aBcc%3Ax',
    'mailto:a%0a@example.com',
    'mailto:a@example.com#fragment',
  ])
    assert.throws(() => emailLink(invalid));
  assert.throws(() => emailLink('a@example.com', 'x'.repeat(121)));
  assert.throws(() => emailLink('a@example.com', '', 'x'.repeat(501)));
  assert.throws(() => normalizeDestination('website', 'mailto:a@example.com'));
  const data = change(base, {
    ...link,
    platform: 'email',
    destination: 'hello@example.com',
    emailSubject: 'Hello',
    emailBody: 'Meet soon?',
  });
  assert.equal(parseEmailLink(data.links[0].url).subject, 'Hello');
  assert.throws(() => change(base, { ...link, emailSubject: 'Not an email' }));
});

test('aliases follow the stable item through renames and updates and stop working when hidden/deleted', async () => {
  let data = change(base, link);
  const id = data.links[0].id;
  data = change(data, {
    ...link,
    originalSlug: 'code',
    slug: 'github',
    aliases: undefined,
    destination: 'https://github.com/alex',
  });
  assert.equal(data.links[0].id, id);
  assert.equal(data.links.length, 1);
  const p = profile(data);
  assert.equal(await resolveLinkDestination(p, 'GH', async () => p), 'https://github.com/alex');
  assert.equal(findVisibleLink(p, 'source')?.slug, 'github');
  assert.equal(findVisibleLink(p, 'code'), undefined);
  data = change(data, {
    ...link,
    originalSlug: 'github',
    slug: 'github',
    aliases: undefined,
    visible: false,
  });
  assert.equal(findVisibleLink(data, 'gh'), undefined);
  data = change(data, { action: 'delete_link', slug: 'github' });
  assert.equal(findVisibleLink(data, 'source'), undefined);
});

test('aliases share the primary slug namespace and cannot chain or overwrite another item', () => {
  const data = change(base, link);
  for (const update of [
    { ...link, slug: 'gh' },
    { ...link, slug: 'other', aliases: ['code'] },
    { ...link, slug: 'other', aliases: ['SOURCE'] },
    { ...link, aliases: ['code'] },
    { ...link, aliases: ['same', 'SAME'] },
    { ...link, createOnly: true },
  ])
    assert.throws(() => change(data, update));
  assert.throws(() =>
    change(base, { ...link, aliases: Array.from({ length: 11 }, (_, i) => `alias${i}`) }),
  );
  const cleared = change(data, { ...link, aliases: [] });
  assert.equal(findVisibleLink(cleared, 'gh'), undefined);
});

test('redirect loops through item aliases and username aliases are detected; email aliases are terminal', async () => {
  const loop = profile(change(base, { ...link, destination: 'https://wya.im/old/gh' }));
  await assert.rejects(
    resolveLinkDestination(loop, 'source', async () => loop),
    { status: 508 },
  );
  const email = profile(
    change(base, {
      ...link,
      platform: 'email',
      destination: 'hello@example.com',
      emailSubject: 'Hello',
    }),
  );
  assert.equal(
    await resolveLinkDestination(email, 'source', async () => email),
    'mailto:hello@example.com?subject=Hello',
  );
});

test('projects are structured, hidden by default, bounded, and retain aliases and IDs when edited', async () => {
  let data = change(base, project);
  const id = data.links[0].id;
  assert.equal(data.links[0].visible, false);
  assert.equal(findVisibleLink(data, 'app'), undefined);
  assert.equal(data.links[0].url, 'https://example.com/demo');
  assert.equal(data.links[0].project?.buttons.length, 2);
  data = change(data, {
    ...project,
    originalSlug: 'portfolio',
    slug: 'new-app',
    aliases: undefined,
    visible: true,
    coverUrl: 'https://example.com/cover.webp',
  });
  assert.equal(data.links[0].id, id);
  assert.equal(findVisibleLink(data, 'app')?.slug, 'new-app');
  assert.equal(
    await resolveLinkDestination(profile(data), 'app', async () => null),
    'https://example.com/demo',
  );
  assert.throws(() => change(data, { ...link, slug: 'new-app' }), /project editor/);
  assert.throws(
    () => change(change(base, link), { ...project, slug: 'code' }),
    /belongs to a link/,
  );
  assert.throws(
    () => change(data, { ...project, slug: 'new-app', createOnly: true }),
    /already used/,
  );
  const noCover = change(data, {
    ...project,
    originalSlug: 'new-app',
    slug: 'new-app',
    aliases: undefined,
    coverUrl: null,
  });
  assert.equal(noCover.links[0].project?.coverUrl, undefined);
  assert.equal(
    noCover.links[0].visible,
    true,
    'Edits preserve published state when visibility is omitted',
  );
  for (const coverUrl of [
    'javascript:alert(1)',
    'data:image/svg+xml,x',
    'http://example.com/image',
    'https://user:secret@example.com/image',
  ])
    assert.throws(() => change(base, { ...project, coverUrl }));
  assert.throws(() => change(base, { ...project, buttons: [] }));
  assert.throws(() => change(base, { ...project, buttons: Array(4).fill(project.buttons[0]) }));
  assert.throws(() =>
    change(base, { ...project, buttons: [{ label: 'Demo', destination: 'javascript:alert(1)' }] }),
  );
  assert.throws(() => change(base, { ...project, description: 'x'.repeat(801) }));
  let full = base;
  for (let i = 0; i < MAX_PROJECTS; i++)
    full = change(full, { ...project, slug: `project-${i}`, aliases: [] });
  assert.throws(() => change(full, { ...project, slug: 'too-many', aliases: [] }), /12 projects/);
});
