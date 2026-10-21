import type { Platform } from './link-options.ts';

type SocialPreset = {
  host: string;
  path?: string;
  aliases?: string[];
  alternatePaths?: string[];
  username: RegExp;
  reserved?: string[];
  prefix?: string;
};

const simpleUsername = /^[a-zA-Z0-9_-]{1,100}$/;
const dottedUsername = /^[a-zA-Z0-9._-]{1,100}$/;
const socialPresets: Partial<Record<Platform, SocialPreset>> = {
  github: {
    host: 'github.com',
    username: /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/,
    reserved: [
      'about',
      'apps',
      'collections',
      'contact',
      'enterprise',
      'events',
      'explore',
      'features',
      'issues',
      'join',
      'login',
      'marketplace',
      'new',
      'notifications',
      'orgs',
      'organizations',
      'pricing',
      'pulls',
      'search',
      'security',
      'sessions',
      'settings',
      'sponsors',
      'topics',
      'trending',
    ],
  },
  instagram: {
    host: 'www.instagram.com',
    username: /^[a-zA-Z0-9._]{1,30}$/,
    reserved: [
      'about',
      'accounts',
      'api',
      'developer',
      'developers',
      'direct',
      'directory',
      'emails',
      'explore',
      'legal',
      'p',
      'privacy',
      'reel',
      'reels',
      'stories',
      'terms',
      'web',
    ],
  },
  linkedin: { host: 'www.linkedin.com', path: '/in/', username: /^[\p{L}\p{N}_-]{1,100}$/u },
  youtube: {
    host: 'www.youtube.com',
    path: '/@',
    aliases: ['m.youtube.com'],
    username: /^[\p{L}\p{N}\p{M}._·-]{1,30}$/u,
  },
  tiktok: { host: 'www.tiktok.com', path: '/@', username: /^[a-zA-Z0-9._]{1,24}$/ },
  x: {
    host: 'x.com',
    aliases: ['twitter.com', 'mobile.twitter.com', 'mobile.x.com'],
    username: /^[a-zA-Z0-9_]{1,15}$/,
    reserved: [
      'about',
      'account',
      'compose',
      'download',
      'explore',
      'hashtag',
      'home',
      'i',
      'intent',
      'jobs',
      'login',
      'logout',
      'messages',
      'notifications',
      'privacy',
      'search',
      'settings',
      'share',
      'signup',
      'tos',
    ],
  },
  bluesky: {
    host: 'bsky.app',
    path: '/profile/',
    username:
      /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
  },
  threads: {
    host: 'www.threads.com',
    path: '/@',
    aliases: ['threads.net'],
    username: /^[a-zA-Z0-9._]{1,30}$/,
  },
  facebook: {
    host: 'www.facebook.com',
    aliases: ['m.facebook.com', 'web.facebook.com'],
    username: /^[a-zA-Z0-9.]{1,100}$/,
    reserved: [
      'about',
      'ads',
      'business',
      'events',
      'friends',
      'gaming',
      'groups',
      'help',
      'home.php',
      'legal',
      'login',
      'login.php',
      'marketplace',
      'messages',
      'pages',
      'people',
      'photo',
      'photo.php',
      'photos',
      'plugins',
      'policies',
      'privacy',
      'profile.php',
      'reel',
      'reels',
      'search',
      'settings',
      'share',
      'sharer',
      'sharer.php',
      'stories',
      'watch',
    ],
  },
  twitch: {
    host: 'www.twitch.tv',
    aliases: ['m.twitch.tv'],
    username: /^[a-zA-Z0-9_]{1,25}$/,
    reserved: [
      'bits',
      'directory',
      'downloads',
      'drops',
      'friends',
      'inventory',
      'jobs',
      'login',
      'messages',
      'p',
      'payments',
      'search',
      'settings',
      'signup',
      'store',
      'subscriptions',
      'turbo',
      'videos',
      'wallet',
    ],
  },
  soundcloud: {
    host: 'soundcloud.com',
    username: simpleUsername,
    reserved: [
      'charts',
      'connect',
      'discover',
      'feed',
      'for',
      'imprint',
      'jobs',
      'messages',
      'mobile',
      'pages',
      'people',
      'popular',
      'search',
      'settings',
      'signin',
      'signup',
      'stream',
      'terms-of-use',
      'upload',
      'you',
    ],
  },
  telegram: {
    host: 't.me',
    aliases: ['telegram.me', 'telegram.dog'],
    username: /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/,
    reserved: [
      'a',
      'addemoji',
      'addlist',
      'addstickers',
      'addstyle',
      'addtheme',
      'auction',
      'auth',
      'boost',
      'call',
      'confirmphone',
      'contact',
      'giftcode',
      'invoice',
      'joinchat',
      'k',
      'login',
      'm',
      'nft',
      'proxy',
      's',
      'setlanguage',
      'share',
      'socks',
      'web',
      'www',
      'z',
    ],
  },
  reddit: {
    host: 'www.reddit.com',
    path: '/user/',
    alternatePaths: ['/u/'],
    aliases: ['old.reddit.com', 'new.reddit.com'],
    username: /^[a-zA-Z0-9_-]{1,32}$/,
    prefix: 'u/',
  },
  pinterest: {
    host: 'www.pinterest.com',
    aliases: ['br.pinterest.com', 'pinterest.com.br', 'pinterest.co.uk'],
    username: simpleUsername,
    reserved: [
      'business',
      'ideas',
      'login',
      'logout',
      'pin',
      'search',
      'settings',
      'signup',
      'today',
    ],
  },
  dribbble: {
    host: 'dribbble.com',
    username: simpleUsername,
    reserved: [
      'about',
      'designers',
      'directories',
      'hiring',
      'jobs',
      'learn',
      'pro',
      'search',
      'session',
      'shots',
      'signup',
      'tags',
      'teams',
      'uploads',
    ],
  },
  behance: {
    host: 'www.behance.net',
    username: simpleUsername,
    reserved: ['assets', 'for_you', 'gallery', 'galleries', 'hire', 'joblist', 'live', 'search'],
  },
  medium: { host: 'medium.com', path: '/@', username: dottedUsername },
  substack: { host: 'substack.com', path: '/@', username: simpleUsername },
};

export type SocialProfile = { platform: Platform; username: string; detail: string };

export function supportsSocialUsername(platform: Platform): boolean {
  return Boolean(socialPresets[platform]);
}

function validUsername(preset: SocialPreset, username: string): boolean {
  return (
    preset.username.test(username) &&
    /[\p{L}\p{N}]/u.test(username) &&
    !preset.reserved?.includes(username.toLowerCase())
  );
}

function hostname(value: string): string {
  return value.toLowerCase().replace(/^www\./, '');
}

/** Recognize profile routes only. No account lookups or guesses from opaque IDs. */
export function getSocialProfile(value: string): SocialProfile | null {
  if (value.length > 2048 || /[\p{Cc}\p{Cf}\\]/u.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port)
    return null;
  const host = hostname(url.hostname);
  for (const [platform, preset] of Object.entries(socialPresets)) {
    if (![preset.host, ...(preset.aliases ?? [])].some((candidate) => hostname(candidate) === host))
      continue;
    for (const path of [preset.path ?? '/', ...(preset.alternatePaths ?? [])]) {
      if (!url.pathname.startsWith(path)) continue;
      let username: string;
      try {
        username = decodeURIComponent(url.pathname.slice(path.length).replace(/\/$/, ''));
      } catch {
        continue;
      }
      if (!validUsername(preset, username)) continue;
      // Facebook numeric profile addresses are IDs, not usernames.
      if (platform === 'facebook' && /^\d+$/.test(username)) continue;
      return {
        platform: platform as Platform,
        username,
        detail: `${preset.prefix ?? '@'}${username}`,
      };
    }
  }
  return null;
}

/** Expand a username using its selected preset; leave full destinations untouched. */
export function socialDestination(platform: Platform, value: string): string {
  const input = value.trim();
  if (/^https?:\/\//i.test(input)) return input;
  // Also accept a recognized profile address pasted without its scheme.
  if (getSocialProfile(`https://${input}`)) return `https://${input}`;
  const preset = socialPresets[platform];
  if (!preset) return input;
  let username = input.replace(/^@/, '');
  if (platform === 'reddit') username = username.replace(/^u\//, '');
  if (!validUsername(preset, username)) return input;
  return `https://${preset.host}${preset.path ?? '/'}${encodeURIComponent(username)}`;
}
