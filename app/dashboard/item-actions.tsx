'use client';
import {itemLabel} from '@/lib/item-label';
import {useRef,useState} from 'react';
import {Popover} from 'radix-ui';
import {ArrowDown,ArrowUp,ArrowUpRight,MoreHorizontal,Trash2,X} from 'lucide-react';
import type {LinkItem} from '@/lib/model';

export function ItemActions({item,busy,canMoveUp,canMoveDown,onMove,sections,onAssign,tabs,activeTabId,onTabAssign,onDelete}:{
  item:LinkItem;busy:boolean;canMoveUp:boolean;canMoveDown:boolean;onMove:(direction:-1|1)=>void;
  sections:{id:string;title:string}[];onAssign:(sectionId:string)=>void;
  tabs?:{id:string;title:string}[];activeTabId?:string;onTabAssign?:(tabId:string)=>void;
  onDelete:()=>void;
}) {
  const [open,setOpen]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null),deleting=useRef(false);
  return <Popover.Root open={open} onOpenChange={value=>{deleting.current=false;setOpen(value);}}>
    <Popover.Trigger asChild><button ref={trigger} type="button" className="icon-button" aria-label={`More actions for ${itemLabel(item)}`} disabled={busy}><MoreHorizontal size={20}/></button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="item-actions" align="end" sideOffset={8} collisionPadding={12} aria-label={`Actions for ${itemLabel(item)}`} onCloseAutoFocus={event=>{if(deleting.current)event.preventDefault();}}>
      <div className="item-actions-heading"><strong>Organize item</strong><Popover.Close asChild><button type="button" className="icon-button" aria-label="Close item actions"><X size={16}/></button></Popover.Close></div>
      <div className="item-actions-order"><button type="button" disabled={busy||!canMoveUp} onClick={()=>onMove(-1)}><ArrowUp size={16}/>Move up</button><button type="button" disabled={busy||!canMoveDown} onClick={()=>onMove(1)}><ArrowDown size={16}/>Move down</button></div>
      {sections.length>0&&<label>Section<select aria-label={`Section for ${itemLabel(item)}`} value={item.sectionId??''} disabled={busy} onChange={event=>{setOpen(false);onAssign(event.target.value);}}><option value="">No section</option>{sections.map(section=><option key={section.id} value={section.id}>{section.title||'Untitled section'}</option>)}</select></label>}
      {tabs&&tabs.length>1&&onTabAssign&&<label>Tab<select aria-label={`Tab for ${itemLabel(item)}`} value={activeTabId} disabled={busy} onChange={event=>{setOpen(false);onTabAssign(event.target.value);}}>{tabs.map(tab=><option key={tab.id} value={tab.id}>{tab.title||'Untitled'}</option>)}</select></label>}
      <p className="item-actions-hint">Save layout to publish moves.</p>
      <div className="item-actions-secondary">
        {item.url&&<a href={item.url} target={item.platform==='email'?undefined:'_blank'} rel="noopener noreferrer"><ArrowUpRight size={16}/>Open destination</a>}
        <button type="button" className="danger" disabled={busy} aria-label={`Delete ${itemLabel(item)}`} onClick={()=>{deleting.current=true;trigger.current?.focus();setOpen(false);onDelete();}}><Trash2 size={16}/>Delete item…</button>
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
