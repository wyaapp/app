import {ArrowUpRight} from 'lucide-react';
import type {ItemButton} from '@/lib/item-buttons';

export function ItemButtons({buttons,handle,slug,preview=false}:{buttons:ItemButton[];handle:string;slug:string;preview?:boolean}) {
  return <div className="project-actions">{buttons.map((button,index)=>preview?
    <span className="project-action" key={index}>{button.label}<ArrowUpRight size={15}/></span>:
    <a className="project-action" key={index} href={index===0?`/${handle}/${slug}`:button.url} target="_blank" rel="noopener noreferrer">{button.label}<ArrowUpRight size={15}/></a>
  )}</div>;
}
