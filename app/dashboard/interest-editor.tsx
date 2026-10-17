'use client';
import {useState,type FormEvent} from 'react';
import {Check,X} from 'lucide-react';
import type {LinkItem} from '@/lib/model';
import {interestDefinitions,suggestInterestSlug,type InterestType} from '@/lib/interests';
import {ItemButtonsEditor} from './item-buttons-editor';
import type {ItemButtonDraft} from '@/lib/item-buttons';
import {CatalogPicker} from './catalog-picker';
import {catalogUrl,type CatalogItem} from '@/lib/catalog-types';
import {ContentCover} from '../components/content-cover';
import {LinkIcon} from '../components/link-icon';

export function InterestEditor({item,type,existingSlugs,busy,onSave,onClose}:{item:LinkItem|'new';type:InterestType;handle:string;existingSlugs:string[];busy:boolean;onSave:(data:Record<string,unknown>)=>Promise<boolean>;onClose:()=>void}) {
  const isNew=item==='new',definition=interestDefinitions[type];
  const [selected,setSelected]=useState<CatalogItem|null>(null);
  const [searching,setSearching]=useState(isNew);
  const [buttons,setButtons]=useState<ItemButtonDraft[]>(isNew?[]:(item.interest?.buttons??[]).map(button=>({label:button.label,destination:button.url})));
  const title=selected?.title??(isNew?'':item.label);
  const cover=selected?selected.coverUrl:(isNew?undefined:item.interest?.coverUrl);
  const source=selected?.source??(isNew?undefined:item.interest?.catalog);
  const gameUrl=source?catalogUrl(source):isNew?'':item.url;
  function choose(result:CatalogItem) {
    const defaultButton={label:'Game page',destination:catalogUrl(result.source)};
    setButtons(current=>!current.length?[defaultButton]:current.map((button,index)=>
      index===0&&button.label==='Game page'&&button.destination===gameUrl?defaultButton:button));
    setSelected(result);setSearching(false);
  }
  async function saveSelection(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(isNew&&!selected||busy)return;
    const catalog=selected?.source??(isNew?undefined:item.interest?.catalog);
    const fallback=selected||!isNew&&item.interest?.buttons?.length?(catalog?catalogUrl(catalog):null):isNew?null:item.url||null;
    if(await onSave({
      action:'upsert_interest',interestType:type,createOnly:isNew,
      slug:isNew?suggestInterestSlug(title,existingSlugs,type):item.slug,
      ...(!isNew?{originalSlug:item.slug}:{}),label:title,buttons,
      ...(selected?{catalog:selected.source,coverUrl:selected.coverUrl??null}:{}),
      ...(!buttons.length?{destination:fallback}:{}),
      ...(isNew?{visible:true}:{}),
    }))onClose();
  }
  return <section className="editor-panel interest-selection-panel">
    <div className="panel-heading"><h2>{isNew?`Add a ${definition.label.toLowerCase()}`:`Edit ${definition.label.toLowerCase()}`}</h2><button type="button" className="icon-button" aria-label="Close interest editor" onClick={onClose} disabled={busy}><X size={18}/></button></div>
    {searching?<CatalogPicker type={type} disabled={busy} onSelect={choose}/>:<>
      <div className="catalog-selection" aria-label={`Selected ${definition.label.toLowerCase()}`}>
        <ContentCover url={cover} className="catalog-selection-cover" fallback={<span className="catalog-selection-cover interest-cover-fallback" aria-hidden="true"><LinkIcon platform="website" icon={definition.icon}/></span>}/>
        <div><strong>{title}</strong>{selected&&<small>{[selected.year,...selected.platforms].filter(Boolean).join(' · ')}</small>}<button type="button" className="text-link" disabled={busy} onClick={()=>setSearching(true)}>Choose another {definition.label.toLowerCase()}</button></div>
      </div>
      <form onSubmit={saveSelection} onInvalidCapture={event=>{(event.target as HTMLElement).closest('details')?.setAttribute('open','');}}>
        <details className="game-button-options" open={buttons.length?true:undefined}>
          <summary>Buttons (optional)</summary>
          <ItemButtonsEditor buttons={buttons} onChange={setButtons} busy={busy} hint="Add up to three links, such as Steam, Official site, or My review." newLabel={buttons.length?'Steam':'Game page'} newDestination={buttons.length?'':gameUrl}/>
        </details>
      <div className="catalog-selection-actions"><button type="submit" className="button button-dark" disabled={busy||isNew&&!selected}>{busy?'Saving…':isNew?`Add ${definition.label.toLowerCase()}`:'Save game'}<Check size={16}/></button><button type="button" className="text-link" disabled={busy} onClick={onClose}>Cancel</button></div>
      </form>
    </>}
  </section>;
}
