import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLinkDestination, MAX_REDIRECT_LINKS } from '../lib/link-redirects.ts';
import type { Profile } from '../lib/model.ts';

function directory() {
  const profiles = new Map<string, Profile>();
  const add = (handle: string, urls: Record<string, string>, aliases: string[] = []) => {
    const p: Profile = {
      id: `id:${handle}`,
      handle,
      aliases,
      name: handle,
      bio: '',
      theme: 'lilac',
      version: 1,
      updatedAt: '',
      links: Object.entries(urls).map(([slug, url]) => ({
        slug,
        url,
        label: slug,
        visible: true,
        platform: 'website',
      })),
    };
    profiles.set(handle, p);
    for (const alias of aliases) profiles.set(alias, p);
    return p;
  };
  let reads = 0;
  const lookup = async (handle: string) => {
    reads++;
    return profiles.get(handle) ?? null;
  };
  return { add, lookup, reads: () => reads };
}

test('homepage, profile pages and external destinations stay usable, including query and fragment', async () => {
  const d = directory();
  for (const url of [
    'https://wya.im/',
    'https://wya.im/alex?ref=portfolio#work',
    'https://wya.im/api/auth/get-session',
    'https://external.example/a/b?ref=1#work',
    'https://wya.im:8443/alex/go',
  ]) {
    const p = d.add('alex', { go: url });
    assert.equal(await resolveLinkDestination(p, 'go', d.lookup), url);
  }
});

test('internal chains collapse to one destination and preserve fragment inheritance', async () => {
  const d = directory(),
    a = d.add('alex', { go: 'https://www.wya.im/bob/work#gallery' });
  const b = d.add('bob', { work: 'https://example.com/project?ref=bob' });
  assert.equal(
    await resolveLinkDestination(a, 'go', d.lookup),
    'https://example.com/project?ref=bob#gallery',
  );
  b.links[0].url = 'https://example.com/project#details';
  assert.equal(
    await resolveLinkDestination(a, 'go', d.lookup),
    'https://example.com/project#details',
  );
  b.links[0].url = 'https://example.com/project#';
  assert.equal(await resolveLinkDestination(a, 'go', d.lookup), 'https://example.com/project#');
});

test('self-cycles include aliases, encoded paths, query/fragment changes, and local origins', async () => {
  for (const url of [
    'https://wya.im/alex/go',
    'https://WYA.IM./ALEX/%67o/?x=1#next',
    'https://www.wya.im/old/go',
    'http://127.0.0.1:8787/alex/go',
  ]) {
    const d = directory(),
      p = d.add('alex', { go: url }, ['old']);
    await assert.rejects(
      resolveLinkDestination(p, 'go', d.lookup, { origin: 'http://127.0.0.1:8787' }),
      { status: 508 },
    );
  }
});

test('cross-space cycles introduced after save are stopped at visit time', async () => {
  const d = directory(),
    a = d.add('alex', { go: 'https://wya.im/bob/go' }),
    b = d.add('bob', { go: 'https://example.com/' });
  assert.equal(await resolveLinkDestination(a, 'go', d.lookup), 'https://example.com/');
  b.links[0].url = 'https://wya.im/alex/go';
  await assert.rejects(resolveLinkDestination(a, 'go', d.lookup), { status: 508 });
});

test('hidden links never resolve and long chains have a bounded database cost', async () => {
  const d = directory(),
    a = d.add('alex', { go: 'https://wya.im/bob/private' }),
    b = d.add('bob', { private: 'https://example.com/private' });
  b.links[0].visible = false;
  await assert.rejects(resolveLinkDestination(a, 'go', d.lookup), { status: 404 });
  await assert.rejects(resolveLinkDestination(b, 'private', d.lookup), { status: 404 });
  assert.equal(
    await resolveLinkDestination(a, 'go', d.lookup, { allowUnavailable: true }),
    'https://wya.im/bob/private',
  );
  const chain = directory();
  for (let i = 0; i <= MAX_REDIRECT_LINKS; i++)
    chain.add(`user${i}`, { go: `https://wya.im/user${i + 1}/go` });
  const start = (await chain.lookup('user0'))!;
  await assert.rejects(resolveLinkDestination(start, 'go', chain.lookup), { status: 508 });
  assert.equal(chain.reads(), MAX_REDIRECT_LINKS + 1);
});

test('custom-domain links collapse chains and detect cycles across Wya and vanity addresses', async () => {
  const d = directory();
  const a = d.add('alex', { go: 'https://lecastro.me/work', work: 'https://example.com/project' });
  a.publicDomain = { hostname: 'lecastro.me', redirect: false };
  const options = {
    customDomain: 'lecastro.me',
    lookupDomain: async (hostname: string) => (hostname === 'lecastro.me' ? a : null),
  };
  assert.equal(
    await resolveLinkDestination(a, 'go', d.lookup, options),
    'https://example.com/project',
  );
  a.links[1].url = 'https://wya.im/alex/go';
  await assert.rejects(resolveLinkDestination(a, 'go', d.lookup, options), { status: 508 });
  a.links[0].url = 'https://lecastro.me:8443/work';
  assert.equal(await resolveLinkDestination(a, 'go', d.lookup, options), a.links[0].url);
  const b = d.add('bob', { go: 'https://lecastro.me/go' });
  a.links[0].url = 'https://wya.im/bob/go';
  await assert.rejects(
    resolveLinkDestination(b, 'go', d.lookup, { lookupDomain: options.lookupDomain }),
    { status: 508 },
  );
});

test('collection short links land on the correct custom-domain tab and anchor', async () => {
  const d = directory();
  const a = d.add('alex', { games: '' });
  a.links[0].kind = 'collection';
  a.links[0].id = 'my-games';
  assert.equal(
    await resolveLinkDestination(a, 'games', d.lookup, { customDomain: 'lecastro.me' }),
    'https://lecastro.me/#widget-my-games',
  );
  assert.equal(
    await resolveLinkDestination(a, 'games', d.lookup),
    'https://wya.im/alex#widget-my-games',
  );
});

test('published file cards resolve to their own stable anchor on hosted and custom addresses', async () => {
  const d = directory();
  const a = d.add('alex', { games: '' });
  a.links[0] = {
    ...a.links[0],
    kind: 'collection',
    id: 'games',
    fileId: 'file-id',
    aliases: ['old-games'],
  };
  assert.equal(
    await resolveLinkDestination(a, 'old-games', d.lookup),
    'https://wya.im/alex#file-file-id-widget-games',
  );
  assert.equal(
    await resolveLinkDestination(a, 'games', d.lookup, { customDomain: 'alex.example' }),
    'https://alex.example/#file-file-id-widget-games',
  );
  a.links[0].kind = 'interest';
  assert.equal(
    await resolveLinkDestination(a, 'games', d.lookup),
    'https://wya.im/alex#file-file-id-interest-games',
  );
});

test('same card identities in different files do not falsely trigger a redirect cycle', async () => {
  const d = directory();
  const a = d.add('alex', { first: 'https://wya.im/alex/second', second: 'https://example.com/' });
  a.links[0] = { ...a.links[0], id: 'copied-card', fileId: 'first-file' };
  a.links[1] = { ...a.links[1], id: 'copied-card', fileId: 'second-file' };
  assert.equal(await resolveLinkDestination(a, 'first', d.lookup), 'https://example.com/');
  a.links[1].url = 'https://wya.im/alex/first';
  await assert.rejects(resolveLinkDestination(a, 'first', d.lookup), { status: 508 });
});
