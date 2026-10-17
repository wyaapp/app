'use client';
import { useState, type PointerEvent } from 'react';
import { ArrowUpRight, ArrowUp, ArrowDown, Pencil, Trash2, EyeOff, GripVertical } from 'lucide-react';
import type { LinkItem } from '@/lib/model';
import { LinkIcon } from '../components/link-icon';

export function LinkList({links,handle,busy,onMove,onEdit,onDelete,onDragStart,sections,onAssign}:{
  links:LinkItem[]; handle:string; busy:boolean;
  onMove:(from:number,to:number)=>void;
  onDragStart:(event:PointerEvent,slug:string)=>void;
  sections:{id:string;title:string}[]; onAssign:(slug:string,sectionId:string)=>void;
  onEdit:(link:LinkItem)=>void; onDelete:(link:LinkItem)=>void;
}) {
  const [announcement,setAnnouncement]=useState('');
  function move(from:number,to:number) {
    if(busy || from===to || from<0 || to<0 || to>=links.length) return;
    onMove(from,to);
    setAnnouncement(`${links[from].label} moved to position ${to+1} of ${links.length}. Layout not saved yet.`);
  }
  return <>
    <span className="sr-only" role="status">{announcement}</span>
    <div className="link-list">{links.map((link,index)=><article
      className={`link-row ${link.visible?'':'hidden-link'}`}
      key={link.slug} data-link-slug={link.slug}>
      <button className="icon-button drag-handle" aria-label={`Drag ${link.label} to reorder, or use the up and down buttons`} disabled={busy}
        onPointerDown={event=>onDragStart(event,link.slug)}
        onKeyDown={event=>{
          if(event.key==='ArrowUp' || event.key==='ArrowDown') {event.preventDefault();move(index,index+(event.key==='ArrowUp'?-1:1));}
        }}><GripVertical size={18}/></button>
      <div className={`link-icon platform-${link.platform}`}><LinkIcon platform={link.platform} icon={link.icon}/></div>
      <div className="link-details"><h3>{link.label}{!link.visible&&<span title="Hidden and disabled"><EyeOff size={14}/></span>}</h3><span>/{handle}/{link.slug}</span><a href={link.url} target="_blank" rel="noopener noreferrer">{link.url.replace(/^https?:\/\//,'')}<ArrowUpRight size={11}/></a>{sections.length>0&&<select className="link-section-select" aria-label={`Section for ${link.label}`} value={link.sectionId ?? ''} disabled={busy} onChange={event=>onAssign(link.slug,event.target.value)}><option value="">No section</option>{sections.map(section=><option value={section.id} key={section.id}>{section.title || 'Untitled section'}</option>)}</select>}</div>
      <div className="link-controls">
        <button className="icon-button" aria-label={`Move ${link.label} up`} disabled={busy||index===0} onClick={()=>move(index,index-1)}><ArrowUp size={16}/></button>
        <button className="icon-button" aria-label={`Move ${link.label} down`} disabled={busy||index===links.length-1} onClick={()=>move(index,index+1)}><ArrowDown size={16}/></button>
        <button className="icon-button" aria-label={`Edit ${link.label}`} disabled={busy} onClick={()=>onEdit(link)}><Pencil size={16}/></button>
        <button className="icon-button danger" aria-label={`Delete ${link.label}`} disabled={busy} onClick={()=>onDelete(link)}><Trash2 size={16}/></button>
      </div>
    </article>)}</div>
  </>;
}
