import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSocialProfile,
  socialDestination,
  supportsSocialUsername,
  socialUsernamePlatforms,
  isFederatedSocial,
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
  ['steam', 'alexplays', 'https://steamcommunity.com/id/alexplays', '@alexplays'],
  ['itch-io', 'alex-games', 'https://itch.io/profile/alex-games', '@alex-games'],
  ['lichess', 'alex_chess', 'https://lichess.org/@/alex_chess', '@alex_chess'],
  ['chess-com', 'alex-chess', 'https://www.chess.com/member/alex-chess', '@alex-chess'],
  ['letterboxd', 'alexfilms', 'https://letterboxd.com/alexfilms', '@alexfilms'],
  ['myanimelist', 'alex_anime', 'https://myanimelist.net/profile/alex_anime', '@alex_anime'],
  ['anilist', 'AlexAnime', 'https://anilist.co/user/AlexAnime', '@AlexAnime'],
  ['last-fm', 'alex_music', 'https://www.last.fm/user/alex_music', '@alex_music'],
  ['gitlab', 'alex.dev', 'https://gitlab.com/alex.dev', '@alex.dev'],
  ['codeberg', 'alex-dev', 'https://codeberg.org/alex-dev', '@alex-dev'],
  ['dev-to', 'alex_dev', 'https://dev.to/alex_dev', '@alex_dev'],
  ['codepen', 'alex-dev', 'https://codepen.io/alex-dev', '@alex-dev'],
  ['hashnode', 'alexdev', 'https://hashnode.com/@alexdev', '@alexdev'],
  ['ko-fi', 'alexcreates', 'https://ko-fi.com/alexcreates', '@alexcreates'],
  ['patreon', 'alexcreates', 'https://www.patreon.com/c/alexcreates', '@alexcreates'],
  ['buy-me-a-coffee', 'alexcreates', 'https://buymeacoffee.com/alexcreates', '@alexcreates'],
  ['artstation', 'alexart', 'https://www.artstation.com/alexart', '@alexart'],
  ['deviantart', 'alexart', 'https://www.deviantart.com/alexart', '@alexart'],
  ['snapchat', 'alex.snap', 'https://www.snapchat.com/add/alex.snap', '@alex.snap'],
  ['tumblr', 'alex-blog', 'https://www.tumblr.com/alex-blog', '@alex-blog'],
  ['mastodon', 'alex@mastodon.social', 'https://mastodon.social/@alex', '@alex@mastodon.social'],
  ['pixelfed', 'alex@pixelfed.social', 'https://pixelfed.social/alex', '@alex@pixelfed.social'],
];

test('social presets accept a username or full URL and derive the same profile detail', () => {
  assert.deepEqual(
    profiles.map(([platform]) => platform).sort(),
    [...socialUsernamePlatforms].sort(),
  );
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
      assert.deepEqual(getSocialProfile(normalized), {
        platform,
        username: isFederatedSocial(platform) ? username.split('@')[0] : username,
        detail,
      });
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
    ['https://alex-games.itch.io/', '@alex-games'],
    ['https://alex-blog.tumblr.com/', '@alex-blog'],
    ['https://www.tumblr.com/blog/view/alex-blog', '@alex-blog'],
    ['https://alexart.artstation.com/', '@alexart'],
    ['https://alexart.deviantart.com/', '@alexart'],
    ['https://www.patreon.com/alexcreates?utm_source=wya', '@alexcreates'],
    ['https://mastodon.online/@alex', '@alex@mastodon.online'],
    ['https://mastodon.social/users/alex', '@alex@mastodon.social'],
    ['https://pixelfed.art/alex.art', '@alex.art@pixelfed.art'],
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
    'https://steamcommunity.com/profiles/76561198000000000',
    'https://steamcommunity.com/id/alex/games',
    'https://alex-games.itch.io/a-game',
    'https://itch.io/games',
    'https://itch.io/profile/alex/collections',
    'https://lichess.org/abcdefgh',
    'https://www.chess.com/game/123',
    'https://letterboxd.com/films',
    'https://letterboxd.com/alex/film/arrival',
    'https://myanimelist.net/anime/123',
    'https://anilist.co/anime/123',
    'https://www.last.fm/music/Artist',
    'https://www.last.fm/user/alex/library',
    'https://gitlab.com/explore',
    'https://gitlab.com/alex/repo',
    'https://gitlab.com/alex.keys',
    'https://gitlab.com/alex.atom',
    'https://gitlab.com/-/u/123',
    'https://codeberg.org/alex/repo',
    'https://codeberg.org/alex.keys',
    'https://dev.to/alex/article',
    'https://dev.to/tags',
    'https://codepen.io/alex/pen/abc',
    'https://codepen.io/trending',
    'https://hashnode.com/settings',
    'https://ko-fi.com/alex/posts',
    'https://www.patreon.com/posts/post-123',
    'https://www.patreon.com/user?u=123',
    'https://buymeacoffee.com/alex/extras',
    'https://www.artstation.com/artwork/abc',
    'https://www.deviantart.com/alex/art/example',
    'https://www.snapchat.com/p/uuid',
    'https://www.tumblr.com/dashboard',
    'https://alex-blog.tumblr.com/post/123',
    'https://www.tumblr.com/alex-blog/123/post',
    'https://mastodon.social/@alex/12345',
    'https://pixelfed.social/p/alex/12345',
    'https://pixelfed.social/discover',
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
    'https://itch.io.evil.example/profile/alex',
    'https://a.b.itch.io/',
    'https://api.itch.io/',
    'https://cdn.artstation.com/',
    'https://assets.tumblr.com/',
    'https://steamcommunity.com/id/alex%2F..%2Fbob',
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

test('federated usernames preserve the server and require an explicit preset on unknown servers', () => {
  for (const [platform, path] of [
    ['mastodon', '/@'],
    ['pixelfed', '/'],
  ] as const) {
    for (const input of ['@Alex@photos.example', 'Alex@photos.example', '@Alex@PHOTOS.EXAMPLE']) {
      const url = normalizeDestination(platform, input);
      assert.equal(url, `https://photos.example${path}Alex`);
      assert.equal(getSocialProfile(url), null);
      assert.deepEqual(getSocialProfile(url, platform), {
        platform,
        username: 'Alex',
        detail: '@Alex@photos.example',
      });
      assert.equal(normalizeDestination(platform, url.replace('https://', '')), url);
    }
    for (const input of [
      '@alex',
      '@alex@',
      '@alex@localhost',
      '@alex@127.0.0.1',
      '@alex@server:8080',
      '@alex@server.example/path',
      '@alex@server.example?x=1',
      '@alex@-server.example',
      '@alex@a..example',
      '@alex@server.example@evil.example',
    ]) {
      assert.throws(() => normalizeDestination(platform, input), input);
    }
    assert.equal(getSocialProfile('https://github.com/explore', platform), null);
    assert.equal(getSocialProfile('https://github.com/alex', platform)?.platform, 'github');
    assert.equal(getSocialProfile('https://api.github.com/alex', platform), null);
    assert.equal(getSocialProfile('https://photos.example/alex/posts', platform), null);
  }
  assert.throws(() => normalizeDestination('pixelfed', '@alex@github.com'));
  assert.throws(() => normalizeDestination('mastodon', '@alex@pixelfed.social'));
  assert.equal(getSocialProfile('https://photos.example/@alex'), null);
  assert.equal(getSocialProfile('https://photos.example/alex'), null);
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
