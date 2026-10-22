import type { Profile } from './profile-types.ts';

export function spaceAddress(
  profile: Pick<Profile, 'handle' | 'publicDomain'>,
  origin = 'https://wya.im',
) {
  return profile.publicDomain
    ? `https://${profile.publicDomain.hostname}`
    : `${origin}/${profile.handle}`;
}
export function spacePath(handle: string, customDomain = false, slug?: string) {
  return `${customDomain ? '' : `/${encodeURIComponent(handle)}`}${slug ? `/${encodeURIComponent(slug)}` : customDomain ? '/' : ''}`;
}
