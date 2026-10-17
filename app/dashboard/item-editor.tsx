'use client';
import type {LinkItem} from '@/lib/model';
import {InterestEditor} from './interest-editor';
import {ProjectEditor} from './project-editor';
import {LinkEditor} from './link-editor';

export type EditingItem=LinkItem|'new'|'new-project'|'new-interest';

export function ItemEditor({item,...props}:{
  item:EditingItem;handle:string;existingSlugs:string[];busy:boolean;
  onSave:(data:Record<string,unknown>)=>Promise<boolean>;onClose:()=>void;
}) {
  if(item==='new-interest'||typeof item==='object'&&item.kind==='interest')return <InterestEditor {...props} item={item==='new-interest'?'new':item} type={typeof item==='object'?item.interest!.type:'game'}/>;
  if(item==='new-project'||typeof item==='object'&&item.kind==='project')return <ProjectEditor {...props} project={item==='new-project'?'new':item}/>;
  return <LinkEditor {...props} link={item as LinkItem|'new'}/>;
}
