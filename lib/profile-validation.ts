import { AppError } from './app-error.ts';
import { emailLink } from './email-links.ts';
import type { Platform } from './link-options.ts';
import { socialDestination, supportsSocialUsername } from './social-links.ts';

const reserved = new Set([
  'sign-in',
  'sign-out',
  'consent',
  'connections',
  'api',
  'mcp',
  'dashboard',
  'signin-with-chatgpt',
  'signout-with-chatgpt',
  'callback',
  'admin',
  'www',
  'help',
  'support',
  'settings',
  'login',
  'signup',
  'assets',
  'about',
  'privacy',
  'terms',
  'robots.txt',
  'favicon.ico',
  'favicon.svg',
]);
export function normalizeHandle(value: string): string {
  const handle = value.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$/.test(handle) || reserved.has(handle))
    throw new AppError(
      'Choose an available handle of 1–39 letters, numbers, dots, underscores, or hyphens. Start and end with a letter or number.',
    );
  return handle;
}
export function normalizeDestination(platform: Platform, value: string): string {
  if (platform === 'email') {
    try {
      return emailLink(value);
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : 'Enter a valid email address.');
    }
  }
  const input = socialDestination(platform, value);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError(
      supportsSocialUsername(platform)
        ? 'Enter a valid username or a full profile URL.'
        : 'Enter a full URL starting with https://.',
    );
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new AppError('Use an HTTP or HTTPS link without embedded credentials.');
  return url.href;
}
