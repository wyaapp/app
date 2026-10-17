'use client';
import { useRef, useState, type PointerEvent } from 'react';
import { ArrowUpRight, ArrowUp, ArrowDown, Pencil, Trash2, EyeOff, GripVertical } from 'lucide-react';
import type { LinkItem } from '@/lib/model';
import { LinkIcon } from '../components/link-icon';

export function LinkList({links,handle,busy,onMove,onEdit,onDelete}:{
  links:LinkItem[]; handle:string; busy:boolean;
  onMove:(from:number,to:number)=>void;
  onEdit:(link:LinkItem)=>void; onDelete:(link:LinkItem)=>void;
}) {
  const list=useRef<HTMLDivElement>(null);
  const [drag,setDrag]=useState<{slug:string;target:string}|null>(null);
  const [announcement,setAnnouncement]=useState('');
  function move(from:number,to:number) {
    if(busy || from===to || from<0 || to<0 || to>=links.length) return;
    onMove(from,to);
    setAnnouncement(`${links[from].label} moved to position ${to+1} of ${links.length}. Order not saved yet.`);
  }
  function targetAt(event:PointerEvent) {
    const row=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-link-slug]');
    return row && list.current?.contains(row) ? row.dataset.linkSlug : undefined;
  }
  return <>
    <span className="sr-only" role="status">{announcement}</span>
    <div className="link-list" ref={list}>{links.map((link,index)=><article
      className={`link-row ${link.visible?'':'hidden-link'} ${drag?.slug===link.slug?'link-dragging':''} ${drag?.target===link.slug && drag.slug!==link.slug?'link-drop-target':''}`}
      key={link.slug} data-link-slug={link.slug}>
      <button className="icon-button drag-handle" aria-label={`Drag ${link.label} to reorder, or use the up and down buttons`} disabled={busy || links.length<2}
        onPointerDown={event=>{
          if(event.button!==0 || busy) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({slug:link.slug,target:link.slug});
        }}
        onPointerMove={event=>{
          if(!drag) return;
          const target=targetAt(event);
          if(target) setDrag({...drag,target});
          if(event.clientY<70) window.scrollBy(0,-18);
          else if(event.clientY>window.innerHeight-70) window.scrollBy(0,18);
        }}
        onPointerUp={event=>{
          if(drag) {
            const target=targetAt(event);
            if(target) move(links.findIndex(item=>item.slug===drag.slug),links.findIndex(item=>item.slug===target));
          }
          setDrag(null);
        }}
        onPointerCancel={()=>setDrag(null)} onLostPointerCapture={()=>setDrag(null)}
        onKeyDown={event=>{
          if(event.key==='Escape') setDrag(null);
          if(event.key==='ArrowUp' || event.key==='ArrowDown') {event.preventDefault();move(index,index+(event.key==='ArrowUp'?-1:1));}
        }}><GripVertical size={18}/></button>
      <div className={`link-icon platform-${link.platform}`}><LinkIcon platform={link.platform} icon={link.icon}/></div>
      <div className="link-details"><h3>{link.label}{!link.visible&&<span title="Hidden and disabled"><EyeOff size={14}/></span>}</h3><span>/{handle}/{link.slug}</span><a href={link.url} target="_blank" rel="noopener noreferrer">{link.url.replace(/^https?:\/\//,'')}<ArrowUpRight size={11}/></a></div>
      <div className="link-controls">
        <button className="icon-button" aria-label={`Move ${link.label} up`} disabled={busy||index===0} onClick={()=>move(index,index-1)}><ArrowUp size={16}/></button>
        <button className="icon-button" aria-label={`Move ${link.label} down`} disabled={busy||index===links.length-1} onClick={()=>move(index,index+1)}><ArrowDown size={16}/></button>
        <button className="icon-button" aria-label={`Edit ${link.label}`} disabled={busy} onClick={()=>onEdit(link)}><Pencil size={16}/></button>
        <button className="icon-button danger" aria-label={`Delete ${link.label}`} disabled={busy} onClick={()=>onDelete(link)}><Trash2 size={16}/></button>
      </div>
    </article>)}</div>
  </>;
}
