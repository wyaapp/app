'use client';
import {useState,type FormEvent} from 'react';
import {Check,X} from 'lucide-react';
import type {LinkItem} from '@/lib/model';
import {ItemButtonsEditor} from './item-buttons-editor';
import {AliasField,parseAliases} from './alias-field';

export function ProjectEditor({project,handle,existingSlugs,busy,onSave,onClose}:{project:LinkItem|'new';handle:string;existingSlugs:string[];busy:boolean;onSave:(data:Record<string,unknown>)=>Promise<boolean>;onClose:()=>void}) {
  const isNew=project==='new';
  let available='project';for(let i=2;existingSlugs.includes(available);i++) available=`project-${i}`;
  const [slug,setSlug]=useState(isNew?available:project.slug);
  const [aliases,setAliases]=useState(isNew?'':project.aliases?.join(', ') ?? '');
  const [buttons,setButtons]=useState(isNew?[{label:'Live demo',destination:''}]:project.project!.buttons.map(button=>({label:button.label,destination:button.url})));
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget);
    if(await onSave({action:'upsert_project',createOnly:isNew,slug,...(!isNew?{originalSlug:project.slug}:{}),aliases:parseAliases(aliases),label:form.get('title'),description:form.get('description'),coverUrl:form.get('coverUrl') || null,buttons,visible:form.get('visible')==='on'})) onClose();
  }
  return <section className="editor-panel">
    <div className="panel-heading"><h2>{isNew?'Showcase a project':'Edit your project'}</h2><button className="icon-button" aria-label="Close project editor" onClick={onClose} disabled={busy}><X size={18}/></button></div>
    <form onSubmit={submit}>
      <label>Project title<input name="title" defaultValue={isNew?'':project.label} required maxLength={60} disabled={busy}/></label>
      <label>Description<textarea name="description" defaultValue={isNew?'':project.project!.description} required maxLength={800} rows={4} disabled={busy} placeholder="What did you make, and what makes it worth exploring?"/></label>
      <label>Thumbnail image URL (optional)<input name="coverUrl" type="url" defaultValue={isNew?'':project.project!.coverUrl ?? ''} maxLength={2048} disabled={busy} placeholder="https://your-site.com/project-thumbnail.webp"/><span className="field-description">A hosted HTTPS image, cropped to a small square beside your project. Uploads aren’t available for project images yet.</span></label>
      <label>URL slug<input value={slug} onChange={event=>setSlug(event.target.value)} required maxLength={40} pattern="[A-Za-z0-9](?:[A-Za-z0-9._\-]{0,38}[A-Za-z0-9])?" disabled={busy}/><span className="field-description">wya.im/{handle}/{slug.trim().toLowerCase()} opens the first button’s destination.</span></label>
      {!isNew&&slug.trim().toLowerCase()!==project.slug&&<p className="link-field-help">{parseAliases(aliases).includes(project.slug)?`/${project.slug} will remain an alias.`:`Add ${project.slug} as an alias below if the old short URL should keep working.`}</p>}
      <AliasField value={aliases} onChange={setAliases} busy={busy}/>
      <ItemButtonsEditor buttons={buttons} onChange={setButtons} busy={busy} label="Project buttons" hint="Up to three destinations, such as Live demo, Source code, or Case study." minButtons={1} newLabel="Source code"/>
      <label className="checkbox-label"><input type="checkbox" name="visible" defaultChecked={!isNew&&project.visible} disabled={busy}/>Show project on my profile and enable its short URLs</label>
      <p className="link-field-help">New projects start hidden. You can save your work before making it visible.</p>
      <button className="button button-dark" disabled={busy}>{busy?'Saving…':'Save project'}<Check size={16}/></button>
    </form>
  </section>;
}
