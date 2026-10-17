'use client';
import { useState, useId, type ReactNode, type PointerEvent } from 'react';
import { Pencil, EyeOff, GripVertical } from 'lucide-react';
import type { LinkItem } from '@/lib/model';
import { LinkIcon } from '../components/link-icon';
import {ItemActions} from './item-actions';

export function LinkList({draggingSlug,links,handle,busy,onMove,onEdit,onDelete,onDragStart,sections,onAssign,tabs,activeTabId,onTabAssign,editingSlug,renderEditor}:{
  editingSlug?:string;renderEditor?:(link:LinkItem)=>ReactNode;
  tabs?:{id:string;title:string}[];activeTabId?:string;onTabAssign?:(slug:string,tabId:string)=>void;
  draggingSlug?:string; links:LinkItem[]; handle:string; busy:boolean;
  onMove:(from:number,to:number)=>void;
  onDragStart:(event:PointerEvent,slug:string)=>void;
  sections:{id:string;title:string}[]; onAssign:(slug:string,sectionId:string)=>void;
  onEdit:(link:LinkItem)=>void; onDelete:(link:LinkItem)=>void;
}) {
  const editorId=useId();
  const [announcement,setAnnouncement]=useState('');
  function move(from:number,to:number) {
    if(busy || from===to || from<0 || to<0 || to>=links.length) return;
    onMove(from,to);
    setAnnouncement(`${links[from].label} moved to position ${to+1} of ${links.length}. Layout not saved yet.`);
  }
  return <>
    <span className="sr-only" role="status">{announcement}</span>
    <div className="link-list">{links.map((link,index)=><article
      className={`link-row ${editingSlug===link.slug?'link-row-expanded':''} ${link.visible?'':'hidden-link'} ${draggingSlug===link.slug?'layout-drag-source':''}`}
      key={link.slug} data-link-slug={link.slug}>
      <div className="link-row-summary">
      <button className="icon-button drag-handle" title="Drag to move, or use ↑ / ↓" aria-label={`Drag ${link.label} to reorder, or use arrow keys`} disabled={busy}
        onPointerDown={event=>onDragStart(event,link.slug)}
        onKeyDown={event=>{
          if(event.key==='ArrowUp' || event.key==='ArrowDown') {event.preventDefault();move(index,index+(event.key==='ArrowUp'?-1:1));}
        }}><GripVertical size={18}/></button>
      <div className={`link-icon platform-${link.platform}`}><LinkIcon platform={link.platform} icon={link.icon ?? (link.kind==='project'?'folder':undefined)}/></div>
      <div className="link-details">
        <h3>{link.label}{!link.visible&&<span title="Hidden and disabled"><EyeOff size={14} aria-label="Hidden"/></span>}</h3>
        <div className="link-meta"><span title={`wya.im/${handle}/${link.slug}`}>/{link.slug}</span>{link.kind&&<small>{link.kind==='project'?'Project':link.interest?.type==='game'?'Game':'Interest'}</small>}{Boolean(link.aliases?.length)&&<small>{link.aliases!.length} {link.aliases!.length===1?'alias':'aliases'}</small>}</div>
      </div>
      <div className="link-controls">
        <button type="button" className="icon-button" aria-label={`Edit ${link.label}`} title={editingSlug===link.slug?"Collapse editor":"Edit item"} aria-expanded={editingSlug===link.slug} aria-controls={editingSlug===link.slug?`${editorId}-${link.slug}`:undefined} disabled={busy} onClick={()=>onEdit(link)}><Pencil size={17}/></button>
        <ItemActions item={link} busy={busy} canMoveUp={index>0} canMoveDown={index<links.length-1} onMove={direction=>move(index,index+direction)} sections={sections} onAssign={sectionId=>onAssign(link.slug,sectionId)} tabs={tabs} activeTabId={activeTabId} onTabAssign={onTabAssign?tabId=>onTabAssign(link.slug,tabId):undefined} onDelete={()=>onDelete(link)}/>
      </div>
      </div>
      {editingSlug===link.slug&&<div id={`${editorId}-${link.slug}`} className="inline-item-editor" role="region" aria-label={`Edit ${link.label}`}>{renderEditor?.(link)}</div>}
    </article>)}</div>
  </>;
}
