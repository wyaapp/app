'use client';
import { useState, type FormEvent } from 'react';
import { Check, X } from 'lucide-react';
import { iconIds, linkPresets, platforms, type Platform, type LinkIconId } from '@/lib/link-options';
import type { LinkItem } from '@/lib/model';
import { LinkIcon } from '../components/link-icon';

export function LinkEditor({link,existingSlugs,busy,onSave,onClose}:{existingSlugs:string[];link:LinkItem|'new';busy:boolean;onSave:(data:Record<string,unknown>)=>Promise<boolean>;onClose:()=>void}) {
  const isNew = link === 'new';
  function availableSlug(value:string) {
    let candidate=value;
    for(let suffix=2;existingSlugs.includes(candidate);suffix++) candidate=`${value}-${suffix}`;
    return candidate;
  }
  const [platform,setPlatform] = useState<Platform>(isNew?'website':link.platform);
  const [slug,setSlug] = useState(isNew?availableSlug('website'):link.slug);
  const [label,setLabel] = useState(isNew?'Website':link.label);
  const [icon,setIcon] = useState<LinkIconId|''>(isNew?'':link.icon ?? '');
  const [query,setQuery] = useState('');
  function choosePreset(value:Platform) {
    setPlatform(value);
    if(isNew){setSlug(availableSlug(value));setLabel(linkPresets[value].label);}
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if(await onSave({action:'upsert_link',slug,label,destination:form.get('destination'),platform,icon:icon || null,visible:form.get('visible')==='on'})) onClose();
  }
  const matches = iconIds.filter(id=>id.replaceAll('-',' ').includes(query.trim().toLowerCase()));
  return <section className="editor-panel">
    <div className="panel-heading"><h2>{isNew?'A new place to find you':'Edit your link'}</h2><button className="icon-button" aria-label="Close link editor" onClick={onClose} disabled={busy}><X size={18}/></button></div>
    <form onSubmit={submit}>
      <div className="form-row">
        <label>Link preset<select value={platform} onChange={e=>choosePreset(e.target.value as Platform)} disabled={busy}>{(['Social','Music & video','Work & everyday'] as const).map(group=><optgroup label={group} key={group}>{platforms.filter(p=>linkPresets[p].group===group).map(p=><option value={p} key={p}>{linkPresets[p].label}</option>)}</optgroup>)}</select></label>
        <label>Link name<input name="slug" value={slug} onChange={e=>setSlug(e.target.value)} required maxLength={40} pattern={"[A-Za-z0-9](?:[A-Za-z0-9._\\-]{0,38}[A-Za-z0-9])?"} readOnly={!isNew}/></label>
      </div>
      <label>Label<input name="label" value={label} onChange={e=>setLabel(e.target.value)} required maxLength={60}/></label>
      <label>{platform==='github'||platform==='instagram'?'Username or full URL':'Destination URL'}<input name="destination" defaultValue={isNew?'':link.url} placeholder={linkPresets[platform].placeholder} required maxLength={2048}/></label>
      <fieldset className="icon-picker" disabled={busy}>
        <legend>Link icon</legend>
        <div className="icon-picker-summary"><span className="link-icon"><LinkIcon platform={platform} icon={icon || undefined}/></span><span><strong>{icon?icon.replaceAll('-',' '):'Automatic'}</strong><small>{icon?'Your choice, whatever the destination.':`Uses the ${linkPresets[platform].label} preset icon.`}</small></span></div>
        <label className="icon-auto"><input type="radio" name="icon" value="" checked={!icon} onChange={()=>setIcon('')}/>Use preset icon</label>
        <label className="icon-search">Find an icon<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Try music, coffee, rocket…"/></label>
        <div className="icon-grid">{matches.map(id=><label className={`icon-choice${icon===id?' selected':''}`} key={id}><input type="radio" name="icon" value={id} checked={icon===id} onChange={()=>setIcon(id)}/><LinkIcon icon={id}/><span>{id.replaceAll('-',' ')}</span></label>)}</div>
        {!matches.length&&<p className="icon-empty">No matches. Try another word.</p>}
      </fieldset>
      <label className="checkbox-label"><input type="checkbox" name="visible" defaultChecked={isNew||link.visible}/>Show on my profile and enable this link</label>
      <button className="button button-dark" disabled={busy}>{busy?'Saving…':'Save link'}<Check size={16}/></button>
    </form>
  </section>;
}
