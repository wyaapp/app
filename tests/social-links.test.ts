import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSocialProfile,
  socialDestination,
  supportsSocialUsername,
} from '../lib/social-links.ts';
import { normalizeDestination } from '../lib/profile-validation.ts';
import { actionSchema, applyAction } from '../lib/model.ts';
import type { Platform } from '../lib/link-options.ts';

const profiles: [Platform, string, string, string][] = [
  ['github', 'alex-castro', 'https://github.com/alex-castro', '@alex-castro'],
  ['instagram', 'alex.castro', 'https://www.instagram.com/alex.castro', '@alex.castro'],
  ['linkedin', 'alex-castro', 'https://www.linkedin.com/in/alex-castro', '@alex-castro'],
  ['youtube', 'alexplays', 'https://www.youtube.com/@alexplays', '@alexplays'],
  ['tiktok', 'alex.plays', 'https://www.tiktok.com/@alex.plays', '@alex.plays'],
  ['x', 'alex_dev', 'https://x.com/alex_dev', '@alex_dev'],
  ['bluesky', 'alex.bsky.social', 'https://bsky.app/profile/alex.bsky.social', '@alex.bsky.social'],
  ['threads', 'alex.castro', 'https://www.threads.com/@alex.castro', '@alex.castro'],
  ['facebook', 'alex.castro', 'https://www.facebook.com/alex.castro', '@alex.castro'],
  ['twitch', 'alexplays', 'https://www.twitch.tv/alexplays', '@alexplays'],
  ['soundcloud', 'alex-music', 'https://soundcloud.com/alex-music', '@alex-music'],
  ['telegram', 'alexdev', 'https://t.me/alexdev', '@alexdev'],
  ['reddit', 'alex_dev', 'https://www.reddit.com/user/alex_dev', 'u/alex_dev'],
  ['pinterest', 'alexdesign', 'https://www.pinterest.com/alexdesign', '@alexdesign'],
  ['dribbble', 'alexdesign', 'https://dribbble.com/alexdesign', '@alexdesign'],
  ['behance', 'alexdesign', 'https://www.behance.net/alexdesign', '@alexdesign'],
  ['medium', 'alex.dev', 'https://medium.com/@alex.dev', '@alex.dev'],
  ['substack', 'alexwrites', 'https://substack.com/@alexwrites', '@alexwrites'],
];

test('social presets accept a username or full URL and derive the same profile detail', () => {
  for (const [platform, username, url, detail] of profiles) {
    assert.equal(supportsSocialUsername(platform), true, platform);
    for (const input of [
      username,
      `@${username}`,
      `  @${username}  `,
      url,
      url.replace('https://', ''),
    ]) {
      const normalized = normalizeDestination(platform, input);
      assert.equal(normalized, url, `${platform}: ${input}`);
      assert.deepEqual(getSocialProfile(normalized), { platform, username, detail });
    }
    assert.equal(getSocialProfile(normalizeDestination('website', url))?.detail, detail);
  }
  assert.equal(
    normalizeDestination('reddit', 'u/alex_dev'),
    'https://www.reddit.com/user/alex_dev',
  );
});

test('profile URL recognition handles legacy hosts, query strings, Unicode, and domain handles', () => {
  const examples: [string, string][] = [
    ['https://WWW.Instagram.com/Alex.Castro/?igsh=abc', '@Alex.Castro'],
    ['http://twitter.com/alex_dev#profile', '@alex_dev'],
    ['https://mobile.twitter.com/alex_dev', '@alex_dev'],
    ['https://www.threads.net/@alex.dev/', '@alex.dev'],
    ['https://m.youtube.com/@alexplays', '@alexplays'],
    ['https://youtube.com/@%E6%97%A5%E6%9C%AC%E8%AA%9E', '@日本語'],
    ['https://www.linkedin.com/in/jo%C3%A3o-silva/', '@joão-silva'],
    ['https://bsky.app/profile/alex.dev', '@alex.dev'],
    ['https://old.reddit.com/u/alex_dev/', 'u/alex_dev'],
    ['https://telegram.me/alexdev?profile', '@alexdev'],
    ['https://br.pinterest.com/alexdesign/', '@alexdesign'],
  ];
  for (const [url, detail] of examples) assert.equal(getSocialProfile(url)?.detail, detail, url);
  assert.equal(getSocialProfile(normalizeDestination('youtube', '@日本語'))?.detail, '@日本語');
  assert.equal(normalizeDestination('bluesky', '@alex.dev'), 'https://bsky.app/profile/alex.dev');
});

test('content URLs, service routes, invites, and account IDs are not presented as usernames', () => {
  for (const url of [
    'https://github.com/alex/project',
    'https://github.com/explore',
    'https://instagram.com/p/abc',
    'https://instagram.com/reel/abc',
    'https://instagram.com/accounts/',
    'https://linkedin.com/company/example',
    'https://youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://youtube.com/channel/UC123',
    'https://youtube.com/c/Example',
    'https://youtube.com/@alex/video/123',
    'https://tiktok.com/@alex/video/123',
    'https://x.com/alex/status/123',
    'https://x.com/intent',
    'https://bsky.app/profile/did:plc:example',
    'https://bsky.app/profile/alex.dev/post/123',
    'https://threads.com/@alex/post/abc',
    'https://facebook.com/profile.php?id=123',
    'https://facebook.com/123456789',
    'https://facebook.com/share',
    'https://twitch.tv/directory',
    'https://soundcloud.com/alex/song',
    'https://t.me/+abcdef',
    'https://t.me/share',
    'https://t.me/addstickers',
    'https://reddit.com/r/games',
    'https://pinterest.com/pin/123',
    'https://dribbble.com/shots/123',
    'https://behance.net/gallery/123',
    'https://medium.com/@alex/article',
    'https://substack.com/@alex/note/abc',
    'https://alex.substack.com/',
    'https://discord.gg/alex',
    'https://discord.com/users/123',
    'https://open.spotify.com/user/123',
    'https://wa.me/12345',
    'https://example.com/alex',
  ])
    assert.equal(getSocialProfile(url), null, url);
});

test('recognition does not trust lookalike domains, credentials, malformed URLs, or hidden characters', () => {
  for (const url of [
    'https://github.com.evil.example/alex',
    'https://evil.github.com/alex',
    'https://github.com@evil.example/alex',
    'https://user:password@github.com/alex',
    'https://github.com:8080/alex',
    '//github.com/alex',
    'javascript:alert(1)',
    'https://github.com/%2Falex',
    'https://github.com/%40alex',
    'https://github.com/%ZZ',
    'https://instagram.com/alex%0A',
    'https://instagram.com/alex\n',
    'https://youtube.com/@alex%20dev',
    'https://youtube.com/@alex%E2%80%AE',
    'https://github.com\\alex',
    '',
    'a'.repeat(2049),
  ])
    assert.equal(getSocialProfile(url), null, url);
  for (const [platform] of profiles) {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,x',
      'https://user:pass@github.com/alex',
      '@a/b',
      '@@alex',
      '@alex name',
      '@...',
      '@alex\nadmin',
    ]) {
      assert.throws(() => normalizeDestination(platform, value), `${platform}: ${value}`);
    }
  }
});

test('username support preserves arbitrary HTTP destinations, email, and unsupported presets', () => {
  for (const [platform] of profiles) {
    assert.equal(
      normalizeDestination(platform, 'https://example.com/anything?q=1'),
      'https://example.com/anything?q=1',
    );
  }
  assert.equal(normalizeDestination('email', 'alex@example.com'), 'mailto:alex@example.com');
  for (const platform of ['website', 'discord', 'whatsapp', 'spotify'] as const) {
    assert.equal(supportsSocialUsername(platform), false);
    assert.throws(() => normalizeDestination(platform, '@alex'));
  }
  assert.equal(socialDestination('github', 'not a username'), 'not a username');
  assert.throws(() => normalizeDestination('bluesky', 'alex'));
  assert.throws(() => normalizeDestination('github', 'name/path'));
});

test('link mutations normalize social usernames without changing the display name or short URL', () => {
  const result = applyAction(
    { name: 'Alex', bio: '', theme: 'lilac', links: [] },
    actionSchema.parse({
      action: 'upsert_link',
      expectedVersion: 1,
      platform: 'tiktok',
      slug: 'videos',
      label: 'TikTok',
      destination: '@alex.plays',
      visible: true,
    }),
  );
  const link = result.data.links[0];
  assert.equal(link.label, 'TikTok');
  assert.equal(link.slug, 'videos');
  assert.equal(link.url, 'https://www.tiktok.com/@alex.plays');
  assert.equal(getSocialProfile(link.url)?.detail, '@alex.plays');
  assert.equal('username' in link, false);
});
