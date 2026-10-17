import {applyLayout,getLinkLayout,getLayoutGroups,layoutFromGroups,type LinkLayout} from './link-layout.ts';
import type {ProfileData} from './model.ts';

export const MAX_PROFILE_TABS=5;
export type ProfileTab=LinkLayout & {id:string;title:string;slug:string};
export type ProfileLayout={tabs:ProfileTab[];defaultTabId:string};

export function getProfileLayout(data:ProfileData):ProfileLayout {
  if(data.tabs?.length) return reconcileProfileLayout({tabs:data.tabs,defaultTabId:data.defaultTabId ?? data.tabs[0].id},data);
  return {tabs:[{id:'home',title:'Home',slug:'home',...getLinkLayout(data)}],defaultTabId:'home'};
}

// One item belongs to one tab. Retain local placement through edits, deletion,
// and conflict refreshes; newly discovered items keep their saved placement.
export function reconcileProfileLayout(draft:ProfileLayout,data:ProfileData,rename?:{from:string;to:string}):ProfileLayout {
  const seen=new Set<string>();
  const keep=(slugs:string[])=>slugs.map(slug=>slug===rename?.from?rename.to:slug).filter(slug=>{
    if(seen.has(slug)||!data.links.some(link=>link.slug===slug)) return false;
    seen.add(slug);return true;
  });
  const tabs=draft.tabs.map(tab=>({...tab,ungrouped:keep(tab.ungrouped),sections:tab.sections.map(section=>({...section,slugs:keep(section.slugs)}))}));
  const defaultTabId=tabs.some(tab=>tab.id===draft.defaultTabId)?draft.defaultTabId:tabs[0].id;
  for(const link of data.links) if(!seen.has(link.slug)) {
    const saved=data.tabs?.find(tab=>getLayoutGroups(tab).some(group=>group.slugs.includes(link.slug)));
    const target=tabs.find(tab=>tab.id===saved?.id) ?? tabs.find(tab=>tab.id===defaultTabId)!;
    const section=target.sections.find(section=>section.id===link.sectionId);
    (section?.slugs ?? target.ungrouped).push(link.slug);
  }
  return {tabs,defaultTabId};
}

export function applyProfileLayout<T extends ProfileData>(data:T,layout:ProfileLayout):T {
  const result={...data,tabs:structuredClone(layout.tabs),defaultTabId:layout.defaultTabId,
    links:layout.tabs.flatMap(tab=>applyLayout(data,tab).links)};
  delete result.sections;
  delete result.ungroupedPosition;
  return result;
}

export function moveItemToTab(layout:ProfileLayout,slug:string,targetId:string):ProfileLayout {
  if(!layout.tabs.some(tab=>tab.id===targetId)||!layout.tabs.some(tab=>getLayoutGroups(tab).some(group=>group.slugs.includes(slug)))) return layout;
  const next=structuredClone(layout);
  next.tabs.forEach(tab=>{tab.ungrouped=tab.ungrouped.filter(item=>item!==slug);tab.sections.forEach(section=>{section.slugs=section.slugs.filter(item=>item!==slug);});});
  next.tabs.find(tab=>tab.id===targetId)!.ungrouped.push(slug);
  return next;
}

export function moveSectionToTab(layout:ProfileLayout,sectionId:string,targetId:string):ProfileLayout {
  const source=layout.tabs.find(tab=>tab.sections.some(section=>section.id===sectionId));
  if(!source||source.id===targetId||!layout.tabs.some(tab=>tab.id===targetId)) return layout;
  return {...layout,tabs:layout.tabs.map(tab=>{
    if(tab.id===source.id) return {id:tab.id,title:tab.title,slug:tab.slug,...layoutFromGroups(getLayoutGroups(tab).filter(group=>group.id!==sectionId))};
    if(tab.id===targetId) return {...tab,sections:[...tab.sections,source.sections.find(section=>section.id===sectionId)!]};
    return tab;
  })};
}

export function removeProfileTab(layout:ProfileLayout,id:string,targetId:string):ProfileLayout {
  if(id===targetId||layout.tabs.length===1) return layout;
  const next=structuredClone(layout),source=next.tabs.find(tab=>tab.id===id),target=next.tabs.find(tab=>tab.id===targetId);
  if(!source||!target) return layout;
  target.ungrouped.push(...source.ungrouped);
  target.sections.push(...source.sections);
  next.tabs=next.tabs.filter(tab=>tab.id!==id);
  if(next.defaultTabId===id) next.defaultTabId=targetId;
  return next;
}
