import { z } from 'zod';
export const platforms = ['website', 'github', 'instagram', 'linkedin', 'discord', 'custom'] as const;
export type Platform = typeof platforms[number];
export type LinkItem = { slug: string; label: string; url: string; platform: Platform; visible: boolean };
export type ProfileData = { name: string; bio: string; theme: 'lilac' | 'lime' | 'ink'; links: LinkItem[] };
export type Profile = ProfileData & { handle: string; version: number; updatedAt: string };
export type Revision = { version: number; reason: string; createdAt: string };
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const reserved = new Set(['api', 'mcp', 'dashboard', 'signin-with-chatgpt', 'signout-with-chatgpt', 'callback', 'admin', 'www', 'help', 'support', 'settings', 'login', 'signup', 'assets', 'about', 'privacy', 'terms', 'robots.txt', 'favicon.ico', 'favicon.svg']);
export function normalizeHandle(value: string): string {
  const handle = value.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$/.test(handle) || reserved.has(handle)) throw new AppError('Choose an available handle of 1–39 letters, numbers, dots, underscores, or hyphens. Start and end with a letter or number.');
  return handle;
}
export function normalizeDestination(platform: Platform, value: string): string {
  let input = value.trim();
  if (platform === 'github' || platform === 'instagram') {
    if (!/^https?:\/\//i.test(input)) {
      input = input.replace(/^@/, '');
      if (platform === 'github' && !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(input)) throw new AppError('Enter a valid GitHub username or a full URL.');
      if (platform === 'instagram' && !/^[a-zA-Z0-9._]{1,30}$/.test(input)) throw new AppError('Enter a valid Instagram username or a full URL.');
      input = `https://${platform === 'github' ? 'github.com' : 'www.instagram.com'}/${input}`;
    }
  }
  let url: URL;
  try { url = new URL(input); } catch { throw new AppError('Enter a full URL starting with https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new AppError('Use an HTTP or HTTPS link without embedded credentials.');
  if (['wya.im', 'www.wya.im', 'wya-im.alexcmgpt.chatgpt.site'].includes(url.hostname.toLowerCase())) throw new AppError('Use the final destination, rather than another wya.im link.');
  return url.href;
}
const version = z.number().int().positive();
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9_-]{0,38}[a-z0-9])?$/, 'Use 1–40 letters, numbers, hyphens, or underscores for the link name.');
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_profile'), handle: z.string().max(64), name: z.string().trim().min(1).max(80), bio: z.string().trim().max(280).optional() }).strict(),
  z.object({ action: z.literal('update_profile'), expectedVersion: version, name: z.string().trim().min(1).max(80).optional(), bio: z.string().trim().max(280).optional(), theme: z.enum(['lilac','lime','ink']).optional() }).strict(),
  z.object({ action: z.literal('upsert_link'), expectedVersion: version, slug, label: z.string().trim().min(1).max(60), destination: z.string().trim().min(1).max(2048), platform: z.enum(platforms), visible: z.boolean().default(true) }).strict(),
  z.object({ action: z.literal('delete_link'), expectedVersion: version, slug }).strict(),
  z.object({ action: z.literal('reorder_links'), expectedVersion: version, slugs: z.array(slug).max(100) }).strict(),
  z.object({ action: z.literal('restore_revision'), expectedVersion: version, revision: version }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export function applyAction(data: ProfileData, action: Action): { data: ProfileData; reason: string } {
  const next = structuredClone(data);
  switch(action.action) {
    case 'update_profile':
      if(action.name !== undefined) next.name = action.name;
      if(action.bio !== undefined) next.bio = action.bio;
      if(action.theme !== undefined) next.theme = action.theme;
      return {data: next, reason: 'Updated profile'};
    case 'upsert_link': {
      const link: LinkItem = {slug:action.slug, label:action.label, url:normalizeDestination(action.platform,action.destination),platform:action.platform, visible:action.visible};
      const index = next.links.findIndex(l => l.slug === action.slug);
      if(index < 0) {
        if(next.links.length >= 100) throw new AppError('You can have up to 100 links.');
        next.links.push(link);
      } else next.links[index] = link;
      return {data:next,reason:`${index < 0 ? 'Added' : 'Updated'} /${action.slug}`};
    }
    case 'delete_link':
      if(!next.links.some(l=>l.slug === action.slug)) throw new AppError('Link not found.',404);
      next.links = next.links.filter(l=>l.slug !== action.slug);
      return {data:next,reason:`Removed /${action.slug}`};
    case 'reorder_links':
      if(action.slugs.length !== next.links.length || new Set(action.slugs).size !== next.links.length || action.slugs.some(s=>!next.links.some(l=>l.slug===s))) throw new AppError('Include every existing link exactly once.');
      next.links = action.slugs.map(s=>next.links.find(l=>l.slug===s)!);
      return {data:next,reason:'Reordered links'};
    default: throw new AppError('This operation requires account storage.');
  }
}
