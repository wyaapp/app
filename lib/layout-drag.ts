import {getLayoutGroups,layoutFromGroups,type LinkLayout} from './link-layout.ts';

export type LayoutDrag = {kind:'link'|'section';id:string};
export type LayoutDrop = {kind:'section';beforeId:string|null}|{kind:'link';groupId:string;beforeId:string|null};
export type LayoutGroupRect = {id:string;top:number;bottom:number;rows:{id:string;top:number;bottom:number}[]};

// Use geometry rather than elementFromPoint: whitespace is a valid drop target.
export function layoutDropAt(source:LayoutDrag,y:number,groups:LayoutGroupRect[]):LayoutDrop|null {
  if(source.kind==='section') {
    const sections=groups.filter(group=>group.id!==source.id);
    if(!sections.length) return null;
    return {kind:'section',beforeId:sections.find(group=>y<(group.top+group.bottom)/2)?.id ?? null};
  }
  const distance=(group:LayoutGroupRect)=>Math.max(group.top-y,y-group.bottom,0);
  const group=groups.reduce<LayoutGroupRect|undefined>((best,next)=>!best||distance(next)<distance(best)?next:best,undefined);
  if(!group) return null;
  return {kind:'link',groupId:group.id,beforeId:group.rows.find(row=>row.id!==source.id&&y<(row.top+row.bottom)/2)?.id ?? null};
}

export function dropLayoutItem(layout:LinkLayout,source:LayoutDrag,target:LayoutDrop):LinkLayout {
  if(source.kind!==target.kind) return layout;
  const next=structuredClone(layout);
  if(target.kind==='section') {
    const groups=getLayoutGroups(next);
    const index=groups.findIndex(group=>group.id===source.id);
    if(index<0 || target.beforeId===source.id || (target.beforeId!==null&&!groups.some(group=>group.id===target.beforeId))) return layout;
    const [group]=groups.splice(index,1);
    const before=target.beforeId===null?groups.length:groups.findIndex(item=>item.id===target.beforeId);
    groups.splice(before,0,group);
    const ordered=layoutFromGroups(groups);
    return JSON.stringify(layout)===JSON.stringify(ordered)?layout:ordered;
  } else {
    const all=[next.ungrouped,...next.sections.map(section=>section.slugs)];
    const destination=target.groupId?next.sections.find(section=>section.id===target.groupId)?.slugs:next.ungrouped;
    if(!destination || !all.some(slugs=>slugs.includes(source.id)) || target.beforeId===source.id || (target.beforeId!==null&&!destination.includes(target.beforeId))) return layout;
    for(const slugs of all) {const index=slugs.indexOf(source.id);if(index>=0)slugs.splice(index,1);}
    destination.splice(target.beforeId===null?destination.length:destination.indexOf(target.beforeId),0,source.id);
  }
  return JSON.stringify(layout)===JSON.stringify(next)?layout:next;
}
