import type { ProfileData } from './model.ts';

export const MAX_SECTIONS = 20;
export type LinkSection = {id:string;title:string};
export type LinkLayout = {ungrouped:string[];sections:(LinkSection & {slugs:string[]})[]};

export function getLinkLayout(data:Pick<ProfileData,'links'|'sections'>):LinkLayout {
  const sections=data.sections ?? [];
  return {
    ungrouped:data.links.filter(link=>!sections.some(section=>section.id===link.sectionId)).map(link=>link.slug),
    sections:sections.map(section=>({...section,slugs:data.links.filter(link=>link.sectionId===section.id).map(link=>link.slug)})),
  };
}

// Preserve a draft across link edits/deletions and version-conflict refreshes.
export function reconcileLayout(draft:LinkLayout,data:Pick<ProfileData,'links'|'sections'>,rename?:{from:string;to:string}):LinkLayout {
  const seen=new Set<string>();
  const keep=(slugs:string[])=>slugs.map(slug=>slug===rename?.from?rename.to:slug).filter(slug=>{
    if(seen.has(slug) || !data.links.some(link=>link.slug===slug)) return false;
    seen.add(slug);return true;
  });
  const next={ungrouped:keep(draft.ungrouped),sections:draft.sections.map(section=>({...section,slugs:keep(section.slugs)}))};
  for(const link of data.links) if(!seen.has(link.slug)) {
    const section=next.sections.find(section=>section.id===link.sectionId);
    (section?.slugs ?? next.ungrouped).push(link.slug);
  }
  return next;
}

export function applyLayout<T extends Pick<ProfileData,'links'|'sections'>>(data:T,layout:LinkLayout):T {
  const groups=[{id:undefined,slugs:layout.ungrouped},...layout.sections];
  return {...data,sections:layout.sections.map(({id,title})=>({id,title})),links:groups.flatMap(group=>group.slugs.flatMap(slug=>{
    const original=data.links.find(link=>link.slug===slug);
    if(!original) return [];
    const link={...original};
    if(group.id) link.sectionId=group.id;else delete link.sectionId;
    return [link];
  }))};
}
