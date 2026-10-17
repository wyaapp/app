'use client';
import {useRef,useState,type PointerEvent} from 'react';
import {ArrowUp,ArrowDown,GripVertical,Plus,X} from 'lucide-react';
import type {LinkItem} from '@/lib/model';
import {MAX_SECTIONS,type LinkLayout} from '@/lib/link-layout';
import {LinkList} from './link-list';

type Drag = {kind:'link'|'section';id:string};
export function LayoutEditor({layout,links,handle,busy,onChange,onEdit,onDelete}:{
  layout:LinkLayout;links:LinkItem[];handle:string;busy:boolean;onChange:(layout:LinkLayout)=>void;
  onEdit:(link:LinkItem)=>void;onDelete:(link:LinkItem)=>void;
}) {
  const root=useRef<HTMLDivElement>(null);
  const [drag,setDrag]=useState<Drag|null>(null);
  const [target,setTarget]=useState<string|null>(null);
  const [announcement,setAnnouncement]=useState('');
  const groups=[{id:'',title:'No section',slugs:layout.ungrouped},...layout.sections];
  function moveLink(slug:string,groupId:string,before?:string) {
    if(busy || before===slug) return;
    const next=structuredClone(layout);
    next.ungrouped=next.ungrouped.filter(item=>item!==slug);
    next.sections.forEach(section=>{section.slugs=section.slugs.filter(item=>item!==slug);});
    const slugs=groupId ? next.sections.find(section=>section.id===groupId)?.slugs : next.ungrouped;
    if(!slugs) return;
    const index=before?slugs.indexOf(before):-1;
    slugs.splice(index<0?slugs.length:index,0,slug);
    onChange(next);setAnnouncement('Link moved. Save layout to publish.');
  }
  function moveSection(from:number,to:number) {
    if(busy || to<0 || to>=layout.sections.length || from===to) return;
    const sections=[...layout.sections];const [section]=sections.splice(from,1);sections.splice(to,0,section);
    onChange({...layout,sections});setAnnouncement(`${section.title || 'Section'} moved to position ${to+1}.`);
  }
  function start(event:PointerEvent,source:Drag) {
    if(busy || event.button!==0 || !event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);setDrag(source);
  }
  function dropTarget(event:PointerEvent) {
    const element=document.elementFromPoint(event.clientX,event.clientY);
    const group=element?.closest<HTMLElement>('[data-layout-group]');
    if(!group || !root.current?.contains(group)) return null;
    const row=element?.closest<HTMLElement>('[data-link-slug]');
    const rect=row?.getBoundingClientRect();
    return {group:group.dataset.layoutGroup!,slug:row?.dataset.linkSlug,after:!!rect&&event.clientY>rect.top+rect.height/2};
  }
  function finish(event:PointerEvent) {
    const destination=dropTarget(event);
    if(drag && destination) {
      if(drag.kind==='link') {
        const slugs=groups.find(group=>group.id===destination.group)?.slugs ?? [];
        const index=destination.slug?slugs.indexOf(destination.slug):-1;
        const before=index<0?undefined:slugs[index+(destination.after?1:0)];
        moveLink(drag.id,destination.group,before);
      }
      else moveSection(layout.sections.findIndex(section=>section.id===drag.id),layout.sections.findIndex(section=>section.id===destination.group));
    }
    setDrag(null);setTarget(null);
  }
  return <div className="layout-editor" ref={root}
    onPointerMove={event=>{if(!drag)return;setTarget(dropTarget(event)?.group ?? null);if(event.clientY<70)window.scrollBy(0,-18);else if(event.clientY>window.innerHeight-70)window.scrollBy(0,18);}}
    onPointerUp={finish} onPointerCancel={()=>{setDrag(null);setTarget(null);}} onLostPointerCapture={()=>{setDrag(null);setTarget(null);}}
    onKeyDown={event=>{if(event.key==='Escape'){setDrag(null);setTarget(null);}}}>
    <div className="layout-toolbar"><p className="reorder-help">Drag links between sections or use their section menus. Save layout when you’re ready.</p><button className="button button-light button-small" disabled={busy||layout.sections.length>=MAX_SECTIONS} onClick={()=>onChange({...layout,sections:[...layout.sections,{id:crypto.randomUUID(),title:'New section',slugs:[]}]})}><Plus size={15}/>Add section</button></div>
    <span className="sr-only" role="status">{announcement}</span>
    {groups.map((group,groupIndex)=><section key={group.id} data-layout-group={group.id} className={`layout-group ${target===group.id?'layout-drop-target':''} ${drag?.kind==='section'&&drag.id===group.id?'link-dragging':''}`}>
      {group.id ? <div className="section-editor-heading">
        <button className="icon-button drag-handle" aria-label={`Drag section ${group.title}`} disabled={busy} onPointerDown={event=>start(event,{kind:'section',id:group.id})} onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();moveSection(groupIndex-1,groupIndex-1+(event.key==='ArrowUp'?-1:1));}}}><GripVertical size={18}/></button>
        <input aria-label={`Section title ${groupIndex}`} value={group.title} maxLength={60} required disabled={busy} placeholder="Section title" onChange={event=>onChange({...layout,sections:layout.sections.map(section=>section.id===group.id?{...section,title:event.target.value}:section)})}/>
        <button className="icon-button" aria-label={`Move section ${group.title} up`} disabled={busy||groupIndex===1} onClick={()=>moveSection(groupIndex-1,groupIndex-2)}><ArrowUp size={16}/></button>
        <button className="icon-button" aria-label={`Move section ${group.title} down`} disabled={busy||groupIndex===layout.sections.length} onClick={()=>moveSection(groupIndex-1,groupIndex)}><ArrowDown size={16}/></button>
        <button className="icon-button" aria-label={`Remove section ${group.title}, keep its links`} disabled={busy} onClick={()=>{onChange({ungrouped:[...layout.ungrouped,...group.slugs],sections:layout.sections.filter(section=>section.id!==group.id)});setAnnouncement('Section removed. Its links are now under No section.');}}><X size={18}/></button>
      </div> : layout.sections.length>0&&<h2 className="ungrouped-heading">No section <small>Shown first, without a heading</small></h2>}
      <LinkList links={group.slugs.flatMap(slug=>links.find(link=>link.slug===slug) ?? [])} handle={handle} busy={busy} sections={layout.sections} onAssign={moveLink} onDragStart={(event,slug)=>start(event,{kind:'link',id:slug})} onEdit={onEdit} onDelete={onDelete} onMove={(from,to)=>{
        const slugs=[...group.slugs];const [slug]=slugs.splice(from,1);slugs.splice(to,0,slug);
        onChange(group.id?{...layout,sections:layout.sections.map(section=>section.id===group.id?{...section,slugs}:section)}:{...layout,ungrouped:slugs});
      }}/>
      {group.slugs.length===0&&layout.sections.length>0&&<p className="section-empty">Drop links here or choose this section from a link’s menu.</p>}
    </section>)}
  </div>;
}
