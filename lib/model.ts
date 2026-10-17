import { z } from 'zod';
import { applyLayout, MAX_SECTIONS, type LinkSection } from './link-layout.ts';
import { themeIds, type ProfileTheme } from './profile-themes.ts';
import { platforms, iconIds, type Platform, type LinkIconId } from './link-options.ts';
export { platforms, type Platform } from './link-options.ts';
export type LinkItem = { slug: string; label: string; url: string; platform: Platform; icon?: LinkIconId; visible: boolean; sectionId?: string };
export type ProfileData = { name: string; bio: string; theme: ProfileTheme; links: LinkItem[]; sections?: LinkSection[] };
export type Profile = ProfileData & { id: string; aliases: string[]; handle: string; version: number; updatedAt: string; pictureUrl?: string | null };
export const MAX_SPACES = 5;
export type SpaceSummary = Pick<Profile, 'id' | 'handle' | 'name' | 'theme' | 'version'>;
export type Revision = { version: number; reason: string; createdAt: string };
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const reserved = new Set(['sign-in', 'sign-out', 'consent', 'connections', 'api', 'mcp', 'dashboard', 'signin-with-chatgpt', 'signout-with-chatgpt', 'callback', 'admin', 'www', 'help', 'support', 'settings', 'login', 'signup', 'assets', 'about', 'privacy', 'terms', 'robots.txt', 'favicon.ico', 'favicon.svg']);
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
  return url.href;
}
const spaceId = z.string().trim().min(1).max(160).optional();
export const spaceSelectorSchema = z.object({spaceId}).strict();
const version = z.number().int().positive();
export const pictureActionSchema = z.discriminatedUnion('action',[
  z.object({action:z.literal('remove_profile_picture'),spaceId:z.string().min(1).max(160),expectedVersion:version}).strict(),
  z.object({action:z.literal('copy_profile_picture'),spaceId:z.string().min(1).max(160),sourceSpaceId:z.string().min(1).max(160),expectedVersion:version}).strict(),
]);
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/, 'Use 1–40 letters, numbers, dots, underscores, or hyphens for the URL slug. Start and end with a letter or number.');
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_profile'), handle: z.string().max(64), name: z.string().trim().min(1).max(80), bio: z.string().trim().max(280).optional() }).strict(),
  z.object({ action: z.literal('rename_space'), expectedVersion: version, spaceId, handle:z.string().max(64) }).strict(),
  z.object({ action: z.literal('update_profile'), expectedVersion: version, spaceId, name: z.string().trim().min(1).max(80).optional(), bio: z.string().trim().max(280).optional(), theme: z.enum(themeIds).optional() }).strict(),
  z.object({ action: z.literal('upsert_link'), expectedVersion: version, spaceId, slug, originalSlug: slug.optional(), label: z.string().trim().min(1).max(60), destination: z.string().trim().min(1).max(2048), platform: z.enum(platforms), icon: z.enum(iconIds).nullable().optional(), visible: z.boolean().default(true) }).strict(),
  z.object({ action: z.literal('delete_link'), expectedVersion: version, spaceId, slug }).strict(),
  z.object({ action: z.literal('reorder_links'), expectedVersion: version, spaceId, slugs: z.array(slug).max(100) }).strict(),
  z.object({ action: z.literal('set_layout'), expectedVersion: version, spaceId, ungrouped:z.array(slug).max(100), sections:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),title:z.string().trim().min(1).max(60),slugs:z.array(slug).max(100)}).strict()).max(MAX_SECTIONS) }).strict(),
  z.object({ action: z.literal('restore_revision'), expectedVersion: version, spaceId, revision: version }).strict(),
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
      const index = next.links.findIndex(l => l.slug === (action.originalSlug ?? action.slug));
      if(action.originalSlug !== undefined && index < 0) throw new AppError('Link not found. Reload this space before editing it.',404);
      const renamed = action.originalSlug !== undefined && action.originalSlug !== action.slug;
      if(renamed && next.links.some(l=>l.slug===action.slug)) throw new AppError('That URL slug is already used by another link. Choose a different slug.');
      const icon = action.icon === undefined ? next.links[index]?.icon : action.icon;
      if(icon) link.icon = icon;
      if(next.links[index]?.sectionId) link.sectionId=next.links[index].sectionId;
      if(index < 0) {
        if(next.links.length >= 100) throw new AppError('You can have up to 100 links.');
        next.links.push(link);
      } else next.links[index] = link;
      return {data:next,reason:renamed ? `Changed /${action.originalSlug} to /${action.slug}` : `${index < 0 ? 'Added' : 'Updated'} /${action.slug}`};
    }
    case 'delete_link':
      if(!next.links.some(l=>l.slug === action.slug)) throw new AppError('Link not found.',404);
      next.links = next.links.filter(l=>l.slug !== action.slug);
      return {data:next,reason:`Removed /${action.slug}`};
    case 'set_layout': {
      const slugs=[...action.ungrouped,...action.sections.flatMap(section=>section.slugs)];
      if(new Set(action.sections.map(section=>section.id)).size!==action.sections.length) throw new AppError('Each section needs a unique ID.');
      if(slugs.length!==next.links.length || new Set(slugs).size!==next.links.length || slugs.some(slug=>!next.links.some(link=>link.slug===slug))) throw new AppError('Include every existing link exactly once in the layout, including hidden links.');
      return {data:applyLayout(next,action),reason:'Updated link layout'};
    }
    case 'reorder_links':
      if(action.slugs.length !== next.links.length || new Set(action.slugs).size !== next.links.length || action.slugs.some(s=>!next.links.some(l=>l.slug===s))) throw new AppError('Include every existing link exactly once.');
      next.links = action.slugs.map(s=>next.links.find(l=>l.slug===s)!);
      return {data:next,reason:'Reordered links'};
    default: throw new AppError('This operation requires account storage.');
  }
}
