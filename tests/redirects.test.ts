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
