import { z } from 'zod';
import {itemButtonSchema,MAX_ITEM_BUTTONS,type ItemButton} from './item-buttons.ts';
import {interestTypes,interestStatuses,interestDefinitions,type InterestContent} from './interests.ts';
import {getProfileLayout,applyProfileLayout,reconcileProfileLayout,moveItemToTab,MAX_PROFILE_TABS,type ProfileTab} from './profile-tabs.ts';
import {emailLink} from './email-links.ts';
import { applyLayout, MAX_SECTIONS, type LinkSection } from './link-layout.ts';
import { themeIds, type ProfileTheme } from './profile-themes.ts';
import { platforms, iconIds, type Platform, type LinkIconId } from './link-options.ts';
export { platforms, type Platform } from './link-options.ts';
export type ProjectContent = {description:string;coverUrl?:string;buttons:ItemButton[]};
export const MAX_PROJECTS=12;
export const MAX_LINK_ALIASES=10;
export type LinkItem = { id?:string; aliases?:string[]; kind?:'project'|'interest'; project?:ProjectContent; interest?:InterestContent; slug: string; label: string; url: string; platform: Platform; icon?: LinkIconId; visible: boolean; sectionId?: string };
export type ProfileData = { name: string; bio: string; theme: ProfileTheme; links: LinkItem[]; sections?: LinkSection[]; ungroupedPosition?:number; tabs?:ProfileTab[]; defaultTabId?:string };
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
  if(platform==='email') {try{return emailLink(value);}catch(error){throw new AppError(error instanceof Error?error.message:'Enter a valid email address.');}}
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
const tabId=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const layoutFields={ungroupedPosition:z.number().int().min(0).max(MAX_SECTIONS).optional(),ungrouped:z.array(slug).max(100),sections:z.array(z.object({id:tabId,title:z.string().trim().min(1).max(60),slugs:z.array(slug).max(100)}).strict()).max(MAX_SECTIONS)};
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_profile'), handle: z.string().max(64), name: z.string().trim().min(1).max(80), bio: z.string().trim().max(280).optional() }).strict(),
  z.object({ action: z.literal('rename_space'), expectedVersion: version, spaceId, handle:z.string().max(64) }).strict(),
  z.object({ action: z.literal('update_profile'), expectedVersion: version, spaceId, name: z.string().trim().min(1).max(80).optional(), bio: z.string().trim().max(280).optional(), theme: z.enum(themeIds).optional() }).strict(),
  z.object({ action: z.literal('upsert_link'), expectedVersion: version, spaceId, tabId:tabId.optional(), slug, createOnly:z.boolean().optional(), originalSlug: slug.optional(), aliases:z.array(slug).max(MAX_LINK_ALIASES).optional(), emailSubject:z.string().max(120).optional(), emailBody:z.string().max(500).optional(), label: z.string().trim().min(1).max(60), destination: z.string().trim().min(1).max(2048), platform: z.enum(platforms), icon: z.enum(iconIds).nullable().optional(), visible: z.boolean().default(true) }).strict(),
  z.object({action:z.literal('upsert_project'),expectedVersion:version,spaceId,tabId:tabId.optional(),slug,createOnly:z.boolean().optional(),originalSlug:slug.optional(),aliases:z.array(slug).max(MAX_LINK_ALIASES).optional(),label:z.string().trim().min(1).max(60),description:z.string().trim().min(1).max(800),coverUrl:z.string().trim().max(2048).nullable().optional(),buttons:z.array(itemButtonSchema).min(1).max(MAX_ITEM_BUTTONS),visible:z.boolean().optional()}).strict(),
  z.object({action:z.literal('upsert_interest'),expectedVersion:version,spaceId,tabId:tabId.optional(),slug,createOnly:z.boolean().optional(),originalSlug:slug.optional(),aliases:z.array(slug).max(MAX_LINK_ALIASES).optional(),interestType:z.enum(interestTypes),catalog:z.object({provider:z.literal('igdb'),id:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),slug:z.string().regex(/^[a-z0-9-]+$/).max(200)}).strict().nullable().optional(),label:z.string().trim().min(1).max(60),note:z.string().trim().max(400).optional(),coverUrl:z.string().trim().min(1).max(2048).nullable().optional(),destination:z.string().trim().min(1).max(2048).nullable().optional(),status:z.enum(interestStatuses).nullable().optional(),favorite:z.boolean().optional(),buttons:z.array(itemButtonSchema).max(MAX_ITEM_BUTTONS).optional(),visible:z.boolean().optional()}).strict(),
  z.object({ action: z.literal('delete_link'), expectedVersion: version, spaceId, slug }).strict(),
  z.object({ action: z.literal('reorder_links'), expectedVersion: version, spaceId, slugs: z.array(slug).max(100) }).strict(),
  z.object({action:z.literal('set_layout'),expectedVersion:version,spaceId,tabId:tabId.optional(),...layoutFields}).strict(),
  z.object({action:z.literal('set_tabs'),expectedVersion:version,spaceId,defaultTabId:tabId,tabs:z.array(z.object({id:tabId,title:z.string().trim().min(1).max(30),slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(40),...layoutFields}).strict()).min(1).max(MAX_PROFILE_TABS)}).strict(),
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
    case 'upsert_link':
    case 'upsert_project':
    case 'upsert_interest': {
      if(action.tabId!==undefined&&!getProfileLayout(next).tabs.some(tab=>tab.id===action.tabId)) throw new AppError('Tab not found.',404);
      const index=next.links.findIndex(link=>link.slug===(action.originalSlug ?? action.slug));
      const previous=next.links[index];
      if(action.createOnly && previous) throw new AppError('That URL slug is already used. Choose a different slug.');
      if(action.originalSlug!==undefined && !previous) throw new AppError('Link not found. Reload this space before editing it.',404);
      const expectedKind=action.action==='upsert_project'?'project':action.action==='upsert_interest'?'interest':undefined;
      if(previous && previous.kind!==expectedKind) throw new AppError(previous.kind==='project'?'Use the project editor to edit this item.':!previous.kind?'That slug belongs to a link. Choose a different slug.':'Use the interest editor to edit this item.');
      if(action.action==='upsert_interest' && previous?.interest && previous.interest.type!==action.interestType) throw new AppError('Use the existing interest type when editing this item.');
      const aliases=action.aliases ?? previous?.aliases ?? [];
      const names=[action.slug,...aliases];
      if(new Set(names).size!==names.length) throw new AppError('Aliases must be unique and different from the main URL slug.');
      if(next.links.some((link,i)=>i!==index && [link.slug,...link.aliases ?? []].some(name=>names.includes(name)))) throw new AppError('That URL slug or alias is already used by another item. Choose a different slug.');
      let link:LinkItem;
      if(action.action==='upsert_interest') {
        const cover=action.coverUrl===undefined?previous?.interest?.coverUrl:action.coverUrl;
        const coverUrl=cover?normalizeDestination('website',cover):undefined;
        if(coverUrl&&!coverUrl.startsWith('https://')) throw new AppError('Use an HTTPS image URL for the cover.');
        const buttons=action.buttons===undefined?previous?.interest?.buttons:action.buttons.map(button=>({label:button.label,url:normalizeDestination('website',button.destination)}));
        if(buttons?.length&&action.destination!==undefined&&action.destination!==null&&normalizeDestination('website',action.destination)!==buttons[0].url)throw new AppError('The destination must match the first button, or be omitted.');
        const destination=buttons?.length?buttons[0].url:action.destination!==undefined?action.destination:action.buttons!==undefined&&previous?.interest?.buttons?.length?'':previous?.url;
        const status=action.status===undefined?previous?.interest?.status:action.status;
        const catalog=action.catalog===undefined?previous?.interest?.catalog:action.catalog;
        link={slug:action.slug,label:action.label,url:destination?normalizeDestination('website',destination):'',platform:'website',icon:interestDefinitions[action.interestType].icon,visible:action.visible ?? previous?.visible ?? false,kind:'interest',interest:{type:action.interestType,note:action.note ?? previous?.interest?.note ?? '',favorite:action.favorite ?? previous?.interest?.favorite ?? false,...(coverUrl?{coverUrl}:{}),...(status?{status}:{}),...(catalog?{catalog}:{}),...(buttons!==undefined?{buttons}:{})}};
      } else if(action.action==='upsert_project') {
        if(!previous && next.links.filter(link=>link.kind==='project').length>=MAX_PROJECTS) throw new AppError(`You can have up to ${MAX_PROJECTS} projects per space.`);
        const buttons=action.buttons.map(button=>({label:button.label,url:normalizeDestination('website',button.destination)}));
        const cover=action.coverUrl===undefined?previous?.project?.coverUrl:action.coverUrl;
        const coverUrl=cover?normalizeDestination('website',cover):undefined;
        if(coverUrl && !coverUrl.startsWith('https://')) throw new AppError('Use an HTTPS image URL for the project cover.');
        link={slug:action.slug,label:action.label,url:buttons[0].url,platform:'portfolio',visible:action.visible ?? previous?.visible ?? false,kind:'project',project:{description:action.description,buttons,...(coverUrl?{coverUrl}:{})}};
      } else {
        if(action.platform!=='email' && (action.emailSubject!==undefined || action.emailBody!==undefined)) throw new AppError('Subject and message are only available for email links.');
        let url=normalizeDestination(action.platform,action.destination);
        if(action.platform==='email') {try{url=emailLink(action.destination,action.emailSubject,action.emailBody);}catch(error){throw new AppError(error instanceof Error?error.message:'Invalid email link.');}}
        link={slug:action.slug,label:action.label,url,platform:action.platform,visible:action.visible};
        const icon=action.icon===undefined?previous?.icon:action.icon;
        if(icon) link.icon=icon;
      }
      // Legacy items acquire a deterministic ID on first edit; it survives renames.
      link.id=previous?.id ?? (previous?`legacy:${previous.slug}`:crypto.randomUUID());
      if(aliases.length) link.aliases=aliases;
      if(previous?.sectionId) link.sectionId=previous.sectionId;
      if(index<0) {
        if(next.links.length>=100) throw new AppError('You can have up to 100 items per space.');
        next.links.push(link);
      } else next.links[index]=link;
      const renamed=previous && previous.slug!==action.slug;
      if(next.tabs) {
        let layout=reconcileProfileLayout({tabs:next.tabs,defaultTabId:next.defaultTabId!},next,renamed?{from:previous.slug,to:action.slug}:undefined);
        const target=layout.tabs.find(tab=>tab.id===action.tabId);
        if(target && ![...target.ungrouped,...target.sections.flatMap(section=>section.slugs)].includes(action.slug)) layout=moveItemToTab(layout,action.slug,target.id);
        Object.assign(next,applyProfileLayout(next,layout));
      }
      return {data:next,reason:renamed?`Changed /${previous.slug} to /${action.slug}`:`${index<0?'Added':'Updated'} /${action.slug}`};
    }
    case 'delete_link':
      if(!next.links.some(l=>l.slug === action.slug)) throw new AppError('Link not found.',404);
      next.links = next.links.filter(l=>l.slug !== action.slug);
      if(next.tabs) Object.assign(next,applyProfileLayout(next,getProfileLayout(next)));
      return {data:next,reason:`Removed /${action.slug}`};
    case 'set_tabs': {
      const sections=action.tabs.flatMap(tab=>tab.sections);
      const slugs=action.tabs.flatMap(tab=>[...tab.ungrouped,...tab.sections.flatMap(section=>section.slugs)]);
      if(new Set(action.tabs.map(tab=>tab.id)).size!==action.tabs.length || new Set(action.tabs.map(tab=>tab.slug)).size!==action.tabs.length) throw new AppError('Tab IDs and URL names must be unique.');
      if(!action.tabs.some(tab=>tab.id===action.defaultTabId)) throw new AppError('Choose an existing default tab.');
      if(sections.length>MAX_SECTIONS || new Set(sections.map(section=>section.id)).size!==sections.length) throw new AppError('Use up to 20 sections with unique IDs across all tabs.');
      if(action.tabs.some(tab=>(tab.ungroupedPosition ?? 0)>tab.sections.length)) throw new AppError('The ungrouped position must be within its tab.');
      if(slugs.length!==next.links.length || new Set(slugs).size!==next.links.length || slugs.some(slug=>!next.links.some(link=>link.slug===slug))) throw new AppError('Include every existing item exactly once across all tabs, including hidden items.');
      return {data:applyProfileLayout(next,action),reason:'Updated profile tabs and layout'};
    }
    case 'set_layout': {
      const profileLayout=getProfileLayout(next);
      if(profileLayout.tabs.length>1&&!action.tabId) throw new AppError('Choose a tab with tabId, or use set_tabs to organize the whole profile.');
      const target=profileLayout.tabs.find(tab=>tab.id===(action.tabId ?? profileLayout.defaultTabId));
      if(!target) throw new AppError('Tab not found.',404);
      if(action.ungroupedPosition!==undefined&&action.ungroupedPosition>action.sections.length) throw new AppError('The ungrouped position must be within the layout.');
      const slugs=[...action.ungrouped,...action.sections.flatMap(section=>section.slugs)];
      const existing=[...target.ungrouped,...target.sections.flatMap(section=>section.slugs)];
      if(new Set(action.sections.map(section=>section.id)).size!==action.sections.length) throw new AppError('Each section needs a unique ID.');
      if(slugs.length!==existing.length || new Set(slugs).size!==existing.length || slugs.some(slug=>!existing.includes(slug))) throw new AppError('Include every existing link exactly once in the layout, including hidden links.');
      const layout={ungrouped:action.ungrouped,sections:action.sections,ungroupedPosition:action.ungroupedPosition ?? Math.min(target.ungroupedPosition ?? 0,action.sections.length)};
      if(!next.tabs) return {data:applyLayout(next,layout),reason:'Updated link layout'};
      return applyAction(next,{action:'set_tabs',expectedVersion:action.expectedVersion,...profileLayout,tabs:profileLayout.tabs.map(tab=>tab.id===target.id?{...tab,...layout}:tab)});
    }
    case 'reorder_links':
      if(action.slugs.length !== next.links.length || new Set(action.slugs).size !== next.links.length || action.slugs.some(s=>!next.links.some(l=>l.slug===s))) throw new AppError('Include every existing link exactly once.');
      next.links = action.slugs.map(s=>next.links.find(l=>l.slug===s)!);
      if(next.tabs) {
        const order=(slugs:string[])=>[...slugs].sort((a,b)=>action.slugs.indexOf(a)-action.slugs.indexOf(b));
        next.tabs=next.tabs.map(tab=>({...tab,ungrouped:order(tab.ungrouped),sections:tab.sections.map(section=>({...section,slugs:order(section.slugs)}))}));
      }
      return {data:next,reason:'Reordered links'};
    default: throw new AppError('This operation requires account storage.');
  }
}

/** Aliases belong to the same item, never to another redirect node. */
export function findVisibleLink(profile:Pick<ProfileData,'links'>,slug:string):LinkItem|undefined {
  const name=slug.toLowerCase();
  return profile.links.find(link=>link.visible&&(link.slug===name||link.aliases?.includes(name)));
}
