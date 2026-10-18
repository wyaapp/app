'use client';
import {useId,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Pencil,Plus,Download} from 'lucide-react';
import {MAX_PROFILE_TABS,removeProfileTab,type ProfileLayout} from '@/lib/profile-tabs';
import {RemoveTabControl} from './remove-tab-control';

export function ProfileTabEditor({layout,activeId,busy,onChange,onSelect,onExport}:{layout:ProfileLayout;activeId:string;busy:boolean;onChange:(layout:ProfileLayout)=>void;onSelect:(id:string)=>void;onExport:()=>void}) {
  const settingsPanelId=useId();
  const [settingsId,setSettingsId]=useState('');
  const settingsButton=useRef<HTMLButtonElement>(null);
  const tab=layout.tabs.find(tab=>tab.id===activeId)!;
  const index=layout.tabs.indexOf(tab);
  function update(fields:Partial<typeof tab>) {onChange({...layout,tabs:layout.tabs.map(item=>item.id===tab.id?{...item,...fields}:item)});}
  function move(offset:number) {const tabs=[...layout.tabs];tabs.splice(index,1);tabs.splice(index+offset,0,tab);onChange({...layout,tabs});}
  return <section className="tab-editor" aria-label="Profile tabs">
    <nav className="profile-tabs editor-tabs" aria-label="Edit a profile tab">{layout.tabs.map(item=><div key={item.id} className={`editor-tab${item.id===activeId?' active':''}`}>
      <button type="button" disabled={busy} aria-pressed={item.id===activeId} onClick={()=>{if(item.id!==activeId)setSettingsId('');onSelect(item.id);}}>{item.title||'Untitled'}{layout.defaultTabId===item.id&&<small> · Default</small>}</button>
      {item.id===activeId&&<button ref={settingsButton} type="button" className="editor-tab-edit" disabled={busy} aria-label={`Edit tab ${item.title||'Untitled'}`} title="Edit tab" aria-expanded={settingsId===tab.id} aria-controls={settingsId===tab.id?settingsPanelId:undefined} onClick={()=>setSettingsId(settingsId===tab.id?'':tab.id)}><Pencil size={15}/></button>}
    </div>)}<button type="button" className="editor-add-tab" aria-label="Add tab" title="Add tab" disabled={busy||layout.tabs.length>=MAX_PROFILE_TABS} onClick={()=>{
      let count=2;while(layout.tabs.some(tab=>tab.slug===`tab-${count}`))count++;
      const id=crypto.randomUUID();onChange({...layout,tabs:[...layout.tabs,{id,title:`Tab ${count}`,slug:`tab-${count}`,ungrouped:[],sections:[]}]});setSettingsId(id);onSelect(id);
    }}><Plus size={17}/></button></nav>
    {settingsId===tab.id&&<div id={settingsPanelId} className="tab-settings" role="region" aria-label={`Settings for ${tab.title||'Untitled'}`}>
      <label>Tab name<input value={tab.title} maxLength={30} disabled={busy} onChange={event=>update({title:event.target.value})}/></label>
      <label>Tab URL name<input value={tab.slug} maxLength={40} disabled={busy} onChange={event=>update({slug:event.target.value.toLowerCase()})} aria-describedby="tab-url-help"/></label>
      <p id="tab-url-help" className="subtle">Share with ?tab={tab.slug || 'name'}. Use lowercase letters, numbers, and hyphens. Changing this name changes its shared address.</p>
      <div className="tab-setting-actions"><button type="button" className="text-link" disabled={busy} onClick={onExport}><Download size={15}/> Export tab</button><button type="button" className="button button-small button-light" disabled={busy||layout.defaultTabId===tab.id} onClick={()=>onChange({...layout,defaultTabId:tab.id})}>{layout.defaultTabId===tab.id?'Default tab':'Make default'}</button><button type="button" className="icon-button" aria-label={`Move tab ${tab.title} left`} disabled={busy||index===0} onClick={()=>move(-1)}><ArrowLeft size={18}/></button><button type="button" className="icon-button" aria-label={`Move tab ${tab.title} right`} disabled={busy||index===layout.tabs.length-1} onClick={()=>move(1)}><ArrowRight size={18}/></button></div>
      {layout.tabs.length>1&&<RemoveTabControl key={tab.id} layout={layout} sourceId={tab.id} busy={busy} onConfirm={target=>{onChange(removeProfileTab(layout,tab.id,target));onSelect(target);}} onReturnFocus={()=>settingsButton.current?.focus({preventScroll:true})}/>}
    </div>}
  </section>;
}
