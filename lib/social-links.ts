import type { Platform } from './link-options.ts';
import { socialPresets, type SocialPreset } from './social-presets.ts';

export type SocialProfile = { platform: Platform; username: string; detail: string };

export function supportsSocialUsername(platform: Platform): boolean {
  return Boolean(socialPresets[platform]);
}

export function isFederatedSocial(platform: Platform): boolean {
  return Boolean(socialPresets[platform]?.federated);
}

export const socialUsernamePlatforms = Object.keys(socialPresets) as Platform[];

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

function matchesHost(host: string, preset: SocialPreset): boolean {
  return [preset.host, ...(preset.aliases ?? [])].some((candidate) => hostname(candidate) === host);
}

function validServer(server: string): boolean {
  return (
    server.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(server)
  );
}

function profileFromPath(url: URL, platform: Platform, preset: SocialPreset): SocialProfile | null {
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
      platform,
      username,
      detail: preset.federated
        ? `@${username}@${url.hostname}`
        : `${preset.prefix ?? '@'}${username}`,
    };
  }
  return null;
}

/** Recognize profile routes only. No account lookups or guesses from opaque IDs. */
export function getSocialProfile(value: string, selectedPlatform?: Platform): SocialProfile | null {
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
  for (const platform of socialUsernamePlatforms) {
    const preset = socialPresets[platform]!;
    if (matchesHost(host, preset)) return profileFromPath(url, platform, preset);
    if (preset.subdomain && host.endsWith(`.${hostname(preset.host)}`)) {
      const username = host.slice(0, -(hostname(preset.host).length + 1));
      // Only a profile homepage, never a game, artwork, post, or service subdomain.
      if (
        url.pathname !== '/' ||
        !validUsername(preset, username) ||
        username.includes('.') ||
        ['www', 'api', 'assets', 'cdn', 'help', 'support', 'static', 'docs'].includes(username)
      )
        return null;
      return { platform, username, detail: `@${username}` };
    }
  }
  // A known service with a non-profile path must not be reclassified as a custom server.
  if (
    socialUsernamePlatforms.some((platform) =>
      host.endsWith(`.${hostname(socialPresets[platform]!.host)}`),
    )
  )
    return null;
  const selected = selectedPlatform && socialPresets[selectedPlatform];
  if (selectedPlatform && selected?.federated && validServer(url.hostname))
    return profileFromPath(url, selectedPlatform, selected);
  return null;
}

/** Expand a username using its selected preset; leave full destinations untouched. */
export function socialDestination(platform: Platform, value: string): string {
  const input = value.trim();
  if (/^https?:\/\//i.test(input)) return input;
  // Also accept a recognized profile address pasted without its scheme.
  if (getSocialProfile(`https://${input}`, platform)) return `https://${input}`;
  const preset = socialPresets[platform];
  if (!preset) return input;
  let username = input.replace(/^@/, '');
  if (platform === 'reddit') username = username.replace(/^u\//, '');
  if (preset.federated) {
    const parts = username.split('@');
    if (parts.length !== 2) return input;
    const [user, server] = parts;
    if (!validUsername(preset, user) || !validServer(server)) return input;
    const url = `https://${server.toLowerCase()}${preset.path ?? '/'}${encodeURIComponent(user)}`;
    return getSocialProfile(url, platform)?.platform === platform ? url : input;
  }
  if (!validUsername(preset, username)) return input;
  return `https://${preset.host}${preset.path ?? '/'}${encodeURIComponent(username)}`;
}
