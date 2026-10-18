'use client';
import {useRef,useState} from 'react';
import {Upload,X} from 'lucide-react';
import {parseTabFile,prepareTabImport,TAB_FILE_LIMIT,type TabFile} from '@/lib/tab-transfer';
import type {Profile} from '@/lib/model';

export function TabImport({profile,busy,blocked,onImport}:{profile:Profile;busy:boolean;blocked:boolean;onImport:(file:TabFile)=>Promise<boolean>}) {
  const input=useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<TabFile|null>(null),[error,setError]=useState('');
  let preview:ReturnType<typeof prepareTabImport>|undefined,problem='';
  if(file)try{preview=prepareTabImport(profile,file);}catch(error){problem=error instanceof Error?error.message:'Could not import this tab.';}
  async function read(file:File|undefined) {
    setError('');setFile(null);
    if(!file)return;
    try{if(file.size>TAB_FILE_LIMIT)throw new Error('Tab files must be under 1 MB.');setFile(parseTabFile(JSON.parse(await file.text())));}
    catch(error){setError(error instanceof SyntaxError?'Choose a valid wya.im tab JSON file.':error instanceof Error?error.message:'Could not read this file.');}
  }
  return <div className="tab-transfer">
    <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Tab JSON file" onChange={event=>{void read(event.target.files?.[0]);event.target.value='';}}/>
    <button type="button" className="text-link" disabled={busy||blocked} title={blocked?'Save or discard layout changes and close the entry editor first.':'Import a tab from a JSON file'} onClick={()=>input.current?.click()}><Upload size={15}/> Import tab</button>
    {error&&<p className="message error" role="alert">{error}</p>}
    {file&&<section className="tab-import-preview" aria-label="Import tab preview">
      <div className="panel-heading"><h3>Import “{file.tab.title}”</h3><button className="icon-button" aria-label="Close import preview" disabled={busy} onClick={()=>{setFile(null);setError('');}}><X size={18}/></button></div>
      <p>{file.items.length} entries · {file.tab.sections.length} sections{preview?` · ${preview.itemCount} total items`:''}</p>
      <p className="subtle">Adds a new tab to @{profile.handle}. Existing content stays in place. Visibility is preserved, including hidden items. Image URLs are kept; image files aren’t copied.</p>
      {preview?.tabSlugChanged&&<p>Tab URL: ?tab={file.tab.slug} → ?tab={preview.tab.slug}</p>}
      {!!preview?.renames.length&&<details open><summary>{preview.renames.length} short URLs will change</summary><ul>{preview.renames.map(rename=><li key={rename.from}>/{rename.from} → /{rename.to}</li>)}</ul></details>}
      <p className="subtle">Link destinations stay as exported. Review any links pointing back to the original space.</p>
      {(problem||blocked)&&<p className="message error" role="alert">{problem||'Save or discard layout changes and close the entry editor before importing.'}</p>}
      <div className="tab-setting-actions"><button type="button" className="button button-dark button-small" disabled={busy||blocked||!preview} onClick={async()=>{if(await onImport(file)){setFile(null);setError('');}}}>{busy?'Importing…':'Import as new tab'}</button><button type="button" className="text-link" disabled={busy} onClick={()=>setFile(null)}>Cancel</button></div>
    </section>}
  </div>;
}
