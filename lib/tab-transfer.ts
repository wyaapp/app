import {z} from 'zod';
import {AppError,normalizeDestination,MAX_PROJECTS,type LinkItem,type ProfileData} from './model.ts';
import {platforms,iconIds} from './link-options.ts';
import {interestTypes,interestStatuses} from './interests.ts';
import {getProfileLayout,applyProfileLayout,MAX_PROFILE_TABS} from './profile-tabs.ts';
import {MAX_SECTIONS} from './link-layout.ts';
import {allItems} from './collections.ts';

export const TAB_FILE_LIMIT=1_000_000;
const slug=z.string().regex(/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/);
const webUrl=z.string().max(2048).transform((value,ctx)=>{
  try{return normalizeDestination('website',value);}catch{ctx.addIssue({code:'custom',message:'Use an HTTP or HTTPS URL without credentials.'});return z.NEVER;}
});
const coverUrl=webUrl.refine(value=>value.startsWith('https://'),'Cover images must use HTTPS.');
const buttons=z.array(z.object({label:z.string().trim().min(1).max(30),url:webUrl}).strict()).max(3);
const common={slug,aliases:z.array(slug).max(10).optional(),label:z.string().trim().max(60),visible:z.boolean(),icon:z.enum(iconIds).optional()};
const gameSchema=z.object({...common,kind:z.literal('interest'),label:common.label.min(1),platform:z.literal('website'),url:z.union([z.literal(''),webUrl]),interest:z.object({type:z.enum(interestTypes),note:z.string().max(400),favorite:z.boolean(),coverUrl:coverUrl.optional(),status:z.enum(interestStatuses).optional(),catalog:z.object({provider:z.literal('igdb'),id:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),slug:z.string().regex(/^[a-z0-9-]+$/).max(200)}).strict().optional(),buttons:buttons.optional()}).strict()}).strict();
const itemSchema=z.union([
  z.object({...common,label:common.label.min(1),platform:z.enum(platforms),url:z.string().min(1).max(2048)}).strict().transform((item,ctx)=>{
    try{return {...item,url:normalizeDestination(item.platform,item.url)};}catch{ctx.addIssue({code:'custom',message:'Invalid link destination.'});return z.NEVER;}
  }),
  z.object({...common,kind:z.literal('project'),label:common.label.min(1),platform:z.literal('portfolio'),url:webUrl,project:z.object({description:z.string().trim().min(1).max(800),coverUrl:coverUrl.optional(),buttons:buttons.min(1)}).strict()}).strict().refine(item=>item.url===item.project.buttons[0].url,'Project destination must match its first button.'),
  gameSchema.refine(item=>!item.interest.buttons?.length||item.url===item.interest.buttons[0].url,'Game destination must match its first button.'),
  z.object({...common,kind:z.literal('collection'),platform:z.literal('website'),url:z.literal(''),collection:z.object({type:z.literal('game'),items:z.array(gameSchema).min(1).max(20)}).strict()}).strict(),
]);
export const tabFileSchema=z.object({
  format:z.literal('wya.im/tab'),version:z.literal(1),
  tab:z.object({title:z.string().trim().min(1).max(30),slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(40),ungrouped:z.array(slug).max(100),ungroupedPosition:z.number().int().min(0).max(20).optional(),sections:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),title:z.string().trim().min(1).max(60),slugs:z.array(slug).max(100)}).strict()).max(20)}).strict(),
  items:z.array(itemSchema).max(100),
}).strict().superRefine((file,ctx)=>{
  const items=allItems(file.items as LinkItem[]),names=items.flatMap(item=>[item.slug,...item.aliases??[]]);
  const placed=[...file.tab.ungrouped,...file.tab.sections.flatMap(section=>section.slugs)];
  if(items.length>100||new Set(names).size!==names.length)ctx.addIssue({code:'custom',message:'Use up to 100 items with unique slugs and aliases.'});
  if(placed.length!==file.items.length||new Set(placed).size!==placed.length||placed.some(slug=>!file.items.some(item=>item.slug===slug)))ctx.addIssue({code:'custom',message:'Every item must appear exactly once in the tab layout.'});
  if(new Set(file.tab.sections.map(section=>section.id)).size!==file.tab.sections.length||(file.tab.ungroupedPosition??0)>file.tab.sections.length)ctx.addIssue({code:'custom',message:'Invalid section layout.'});
  for(const item of file.items)if('collection' in item){
    const refs=item.collection.items.flatMap(game=>game.interest.catalog?[game.interest.catalog.id]:[]);
    if(new Set(refs).size!==refs.length)ctx.addIssue({code:'custom',message:'A collection cannot contain the same catalog game twice.'});
    if(item.collection.items.some(game=>game.interest.buttons?.length&&game.url!==game.interest.buttons[0].url))ctx.addIssue({code:'custom',message:'Game destination must match its first button.'});
  }
});
export type TabFile=z.infer<typeof tabFileSchema>;

function portableItem(item:LinkItem):unknown {
  return {slug:item.slug,label:item.label,url:item.url,platform:item.platform,visible:item.visible,
    ...(item.aliases?{aliases:item.aliases}:{}),...(item.icon?{icon:item.icon}:{}),
    ...(item.kind?{kind:item.kind}:{}),...(item.project?{project:item.project}:{}),...(item.interest?{interest:item.interest}:{}),
    ...(item.collection?{collection:{type:item.collection.type,items:item.collection.items.map(portableItem)}}:{})};
}
export function exportTab(data:ProfileData,tabId:string):TabFile {
  const tab=getProfileLayout(data).tabs.find(tab=>tab.id===tabId);
  if(!tab)throw new AppError('Tab not found.',404);
  const names=new Set([...tab.ungrouped,...tab.sections.flatMap(section=>section.slugs)]);
  return parseTabFile({format:'wya.im/tab',version:1,tab:{title:tab.title,slug:tab.slug,ungrouped:tab.ungrouped,sections:tab.sections,...(tab.ungroupedPosition!==undefined?{ungroupedPosition:tab.ungroupedPosition}:{})},items:data.links.filter(item=>names.has(item.slug)).map(portableItem)});
}
export function parseTabFile(value:unknown):TabFile {
  if(new TextEncoder().encode(JSON.stringify(value)??'').length>TAB_FILE_LIMIT)throw new AppError('Tab files must be under 1 MB.');
  const result=tabFileSchema.safeParse(value);
  if(!result.success)throw new AppError(`Invalid tab file. ${result.error.issues.slice(0,3).map(issue=>issue.message).join(' ')}`);
  return result.data;
}
export function prepareTabImport(data:ProfileData,input:unknown) {
  const file=parseTabFile(input),layout=getProfileLayout(data);
  if(layout.tabs.length>=MAX_PROFILE_TABS)throw new AppError('You can have up to 5 tabs. Remove a tab before importing.');
  if(layout.tabs.reduce((sum,tab)=>sum+tab.sections.length,0)+file.tab.sections.length>MAX_SECTIONS)throw new AppError('Import would exceed 20 sections per space.');
  if(allItems(data.links).length+allItems(file.items as LinkItem[]).length>100)throw new AppError('Import would exceed 100 items per space, including games inside collections.');
  if([...data.links,...file.items].filter(item=>'kind' in item&&item.kind==='project').length>MAX_PROJECTS)throw new AppError('Import would exceed 12 projects per space.');
  const used=new Set(allItems(data.links).flatMap(item=>[item.slug,...item.aliases??[]]));
  const incoming=allItems(file.items as LinkItem[]).flatMap(item=>[item.slug,...item.aliases??[]]);
  const reserved=new Set([...used,...incoming]);
  const renames:{from:string;to:string}[]=[],mapping=new Map<string,string>();
  function allocate(name:string,taken:Set<string>,reserve=taken) {
    if(!taken.has(name)){taken.add(name);return name;}
    let candidate=name;
    for(let i=2;taken.has(candidate)||reserve.has(candidate);i++){const suffix=`-${i}`;candidate=name.slice(0,40-suffix.length).replace(/[._-]+$/,'')+suffix;}
    taken.add(candidate);reserve.add(candidate);return candidate;
  }
  for(const name of incoming){const next=allocate(name,used,reserved);mapping.set(name,next);if(name!==next)renames.push({from:name,to:next});}
  const items=structuredClone(file.items) as LinkItem[];
  for(const item of allItems(items)){item.id=crypto.randomUUID();item.slug=mapping.get(item.slug)!;if(item.aliases)item.aliases=item.aliases.map(alias=>mapping.get(alias)!);}
  const tabSlug=allocate(file.tab.slug,new Set(layout.tabs.map(tab=>tab.slug)));
  const tab={...file.tab,id:crypto.randomUUID(),slug:tabSlug,ungrouped:file.tab.ungrouped.map(slug=>mapping.get(slug)!),sections:file.tab.sections.map(section=>({...section,id:crypto.randomUUID(),slugs:section.slugs.map(slug=>mapping.get(slug)!)}))};
  const next=applyProfileLayout({...data,links:[...data.links,...items]},{...layout,tabs:[...layout.tabs,tab]});
  return {data:next,tab,renames,tabSlugChanged:tabSlug!==file.tab.slug,itemCount:allItems(items).length,hiddenCount:allItems(items).filter(item=>!item.visible).length};
}
