'use client';
import Link from 'next/link';
import {allItems} from '@/lib/collections';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { ArrowUpRight, Check, Copy, Sparkles, History, Link2, UserRound, RotateCcw } from 'lucide-react';
import { Brand } from '../components/brand';
import { BrandSpark } from '../components/brand-spark';
import { ProfileCard } from '../components/profile-card';
import {AddItemMenu} from './add-item-menu';
import {CatalogCredit} from '../components/catalog-credit';
import { type Profile, type Revision, type LinkItem, type SpaceSummary, MAX_SPACES } from '@/lib/model';
import { RemoveItemDialog } from './remove-item-dialog';
import { LayoutEditor } from './layout-editor';
import {type LinkLayout} from '@/lib/link-layout';
import {getProfileLayout,reconcileProfileLayout,applyProfileLayout,moveItemToTab,moveSectionToTab,type ProfileLayout} from '@/lib/profile-tabs';
import {ProfileTabEditor} from './profile-tab-editor';
import { PictureEditor } from './picture-editor';
import { BioEditor } from './bio-editor';
import { themeIds, profileThemes } from '@/lib/profile-themes';
import type {FlushEntry} from './use-entry-autosave';
import {ItemEditor,type EditingItem} from './item-editor';
import { CreateSpace, RenameSpace } from './space-controls';
type Tab = 'links'|'profile'|'chatgpt'|'history';
export default function Dashboard({initial,initialTab,initialSpaces,initialHistory,displayName,signOut,standalone}:{initial:Profile|null;initialTab?:Tab;initialSpaces:SpaceSummary[];initialHistory:Revision[];displayName:string;signOut:string;standalone:boolean}) {
  const [profile,setProfile] = useState(initial);
  const [spaces,setSpaces] = useState(initialSpaces);
  const [creating,setCreating] = useState(false);
  const [history,setHistory] = useState(initialHistory);
  const [tab,setTab] = useState<Tab>(initialTab || 'links');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [editing,setEditing] = useState<EditingItem|null>(null);
  const [deleting,setDeleting] = useState<LinkItem | null>(null);
  const latestProfile=useRef(profile);
  useEffect(()=>{latestProfile.current=profile;},[profile]);
  const pendingEntry=useRef<FlushEntry|null>(null);
  const registerAutosave=useCallback((flush:FlushEntry|null)=>{pendingEntry.current=flush;},[]);
  async function finishEntry(){return pendingEntry.current?pendingEntry.current():true;}
  async function navigateFromEditor(event:MouseEvent<HTMLDivElement>) {
    if(!pendingEntry.current||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const anchor=(event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if(!anchor||anchor.target==='_blank'||anchor.hasAttribute('download')||anchor.getAttribute('href')?.startsWith('#'))return;
    event.preventDefault();
    if(await finishEntry())window.location.assign(anchor.href);
  }
  const editTrigger=useRef<HTMLElement|null>(null);
  const deleteTrigger=useRef<HTMLElement|null>(null);
  const addLinkButton=useRef<HTMLButtonElement>(null);
  const [restoring,setRestoring] = useState<Revision | null>(null);
  const [layouts,setLayouts] = useState<Record<string,ProfileLayout>>({});
  const [selectedProfileTab,setSelectedProfileTab]=useState('');
  const profileLayout=profile ? reconcileProfileLayout(layouts[profile.id] ?? getProfileLayout(profile),profile) : {tabs:[{id:'home',title:'Home',slug:'home',ungrouped:[],sections:[]}],defaultTabId:'home'};
  const activeProfileTab=profileLayout.tabs.find(tab=>tab.id===selectedProfileTab) ?? profileLayout.tabs.find(tab=>tab.id===profileLayout.defaultTabId)!;
  const layout=activeProfileTab;
  const newProfileTab=!!profile&&!getProfileLayout(profile).tabs.some(tab=>tab.id===activeProfileTab.id);
  const previewProfile=profile ? applyProfileLayout(profile,profileLayout) : null;
  const layoutChanged=!!profile && JSON.stringify(profileLayout)!==JSON.stringify(getProfileLayout(profile));
  const layoutInvalid=profileLayout.tabs.some(tab=>!tab.title.trim()||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tab.slug)||tab.sections.some(section=>!section.title.trim()))||new Set(profileLayout.tabs.map(tab=>tab.slug)).size!==profileLayout.tabs.length;
  async function selectProfileTab(id:string) {if(!await finishEntry())return;setSelectedProfileTab(id);setEditing(null);setError('');}
  useEffect(()=>{
    if(!Object.keys(layouts).length) return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[layouts]);
  function discardLayout(id:string) {
    setLayouts(current=>{const next={...current};delete next[id];return next;});
  }
  function syncLayout(updated:Profile,rename?:{from:string;to:string},newItem?:{slug:string;tabId:string}) {
    setLayouts(current=>{
      if(!current[updated.id]&&!newItem) return current;
      let layout=reconcileProfileLayout(current[updated.id] ?? getProfileLayout(updated),updated,rename);
      if(newItem) layout=moveItemToTab(layout,newItem.slug,newItem.tabId);
      const next={...current,[updated.id]:layout};
      if(JSON.stringify(layout)===JSON.stringify(getProfileLayout(updated))) delete next[updated.id];
      return next;
    });
  }
  function changeLayout(next:LinkLayout) {changeProfileLayout({...profileLayout,tabs:profileLayout.tabs.map(tab=>tab.id===activeProfileTab.id?{id:tab.id,title:tab.title,slug:tab.slug,...next}:tab)});}
  async function changeProfileLayout(next:ProfileLayout) {
    if(!profile || busy) return;
    if(!await finishEntry())return;
    if(JSON.stringify(next)===JSON.stringify(getProfileLayout(profile))) discardLayout(profile.id);
    else setLayouts(current=>({...current,[profile.id]:next}));
    setNotice('');
  }
  async function save(data:Record<string,unknown>,automatic=false) {
    if(busy) return false;
    setBusy(true);setError('');setNotice('');
    try {
      if(data.action==='group_games'&&layoutChanged)throw new Error('Save or discard your layout changes before grouping games.');
      const newItem=(data.action==='upsert_link'||data.action==='upsert_project'||data.action==='upsert_interest'||data.action==='upsert_collection')&&!profile?.links.some(link=>link.slug===(data.originalSlug ?? data.slug))&&typeof data.slug==='string'?{slug:data.slug.trim().toLowerCase(),tabId:activeProfileTab.id}:undefined;
      if(newItem && newProfileTab) throw new Error('Save layout before adding items to this new tab.');
      if(newItem && profile && getProfileLayout(profile).tabs.some(tab=>tab.id===newItem.tabId)) data={...data,tabId:newItem.tabId};
      const response = await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,...(profile&&data.action!=='create_profile'?{spaceId:profile.id,expectedVersion:profile.version}:{})})});
      const result = await response.json() as {profile:Profile;spaces:SpaceSummary[];history:Revision[];error?:string};
      if(!response.ok) {
        if(response.status===409 && profile) { const fresh=await fetch(`/api/account?spaceId=${encodeURIComponent(profile.id)}`).then(r=>r.json()) as {profile:Profile;spaces:SpaceSummary[];history:Revision[]}; if(fresh.profile?.id===profile.id) {setProfile(fresh.profile);setHistory(fresh.history);setSpaces(fresh.spaces);syncLayout(fresh.profile);} }
        throw new Error(result.error || 'Could not save your changes.');
      }
      latestProfile.current=result.profile;
      setProfile(result.profile);setHistory(result.history);setSpaces(result.spaces);
      if(automatic)setEditing(current=>typeof current==='object'&&current?result.profile.links.find(item=>item.id===current.id&&!!item.id||item.slug===(data.slug??current.slug))??current:current);
      if(data.action==='set_tabs' || data.action==='set_layout' || data.action==='restore_revision'||data.action==='group_games') discardLayout(result.profile.id);
      else syncLayout(result.profile,(data.action==='upsert_link'||data.action==='upsert_project'||data.action==='upsert_interest'||data.action==='upsert_collection') && typeof data.originalSlug==='string' && typeof data.slug==='string'?{from:data.originalSlug,to:data.slug.trim().toLowerCase()}:undefined,newItem);
      window.history.replaceState(null,'',`/dashboard?space=${encodeURIComponent(result.profile.id)}`);
      if(data.action==='create_profile'){setCreating(false);setTab('links');setEditing(null);setDeleting(null);setRestoring(null);}
      const draft=layouts[result.profile.id];
      const remainingDraft=draft&&JSON.stringify(reconcileProfileLayout(draft,result.profile))!==JSON.stringify(getProfileLayout(result.profile));
      if(!automatic)setNotice(data.action==='delete_link'?(remainingDraft?'Item removed. Your other layout changes are still unsaved.':'Item removed.'):(remainingDraft&&data.action!=='set_tabs'&&data.action!=='restore_revision'?'Saved. Your other layout changes are still unsaved.':'Saved. Your space is up to date.'));return true;
    } catch(err){setError(err instanceof Error?err.message:'Could not save your changes.');return false;}
    finally{setBusy(false);}
  }
  async function copyLink(){try{await navigator.clipboard.writeText(`${window.location.origin}/${profile!.handle}`);setNotice('Profile link copied.');}catch{setError('Copy failed. Open your profile and copy its address.');}}
  async function requestDelete(link:LinkItem) {
    if(!await finishEntry())return;
    deleteTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setEditing(null);setError('');setNotice('');setDeleting(latestProfile.current?.links.find(item=>link.id?item.id===link.id:item.slug===link.slug)??link);
  }
  async function closeEditor(){if(!await finishEntry())return;setEditing(null);setError('');requestAnimationFrame(()=>{if(editTrigger.current?.isConnected)editTrigger.current.focus({preventScroll:true});});}
  async function edit(link:EditingItem){
    if(!await finishEntry())return;
    if(typeof link==='object'&&typeof editing==='object'&&editing?.slug===link.slug){closeEditor();return;}
    editTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setEditing(link);setDeleting(null);setError('');
  }
  const alerts = <div className="messages" aria-live="polite">{error&&!(editing&&typeof editing==='object')&&<div className="message error" role="alert">{error}</div>}{notice&&<div className="message success"><Check size={16}/>{notice}</div>}</div>;
  async function selectSpace(id:string) {
    if(busy || id===profile?.id) return;
    if(!await finishEntry())return;
    setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch(`/api/account?spaceId=${encodeURIComponent(id)}`);
      const result=await response.json() as {profile:Profile;spaces:SpaceSummary[];history:Revision[];error?:string};
      if(!response.ok) throw new Error(result.error || 'Could not load this space.');
      setProfile(result.profile);setSpaces(result.spaces);setHistory(result.history);syncLayout(result.profile);
      setEditing(null);setDeleting(null);setRestoring(null);setSelectedProfileTab('');setTab('links');
      window.history.replaceState(null,'',`/dashboard?space=${encodeURIComponent(id)}`);
    } catch(error){setError(error instanceof Error?error.message:'Could not load this space.');}
    finally{setBusy(false);}
  }
  if(!profile || creating) return <div className="site-shell"><header className="site-header"><Brand/><a className="text-link" href={signOut} target="_top">Sign out</a></header><div className="creation-messages">{alerts}</div><CreateSpace count={spaces.length} busy={busy} displayName={displayName} onSave={save} onCancel={profile?()=>setCreating(false):undefined}/></div>;

  return <div className="workspace-shell" onClickCapture={navigateFromEditor}><header className="workspace-header"><Brand/><div className="workspace-header-right"><a href={`/${profile.handle}`} target="_blank" rel="noreferrer" className="text-link">Visit your page <ArrowUpRight size={15}/></a>{standalone && <Link className="text-link" href="/connections">Connections</Link>}<a href={signOut} target="_top" className="user-chip" title="Sign out">{profile.name.charAt(0).toUpperCase()}</a></div></header><div className="workspace-grid"><aside className="sidebar"><div className="sidebar-label">YOUR CONTROL ROOM</div><nav>{([{key:'links',label:'Your links',icon:Link2},{key:'profile',label:'Your profile',icon:UserRound},{key:'chatgpt',label:'Use ChatGPT',icon:Sparkles},{key:'history',label:'Change history',icon:History}] as const).map(item=><button key={item.key} disabled={busy} className={tab===item.key?'active':''} onClick={async()=>{if(!await finishEntry())return;setTab(item.key);setEditing(null);setError('');setNotice('');}}><item.icon size={18}/>{item.label}{item.key==='chatgpt'&&<span className="new-tag">NEW</span>}</button>)}</nav><div className="sidebar-bottom"><span className="little-spark"><BrandSpark/></span><p>One address.<br/>All of you.</p><span>wya.im/{profile.handle}</span></div></aside><main className="workspace-main"><div className="space-switcher"><label><span>Space</span><select aria-label="Your spaces" value={profile.id} onChange={async event=>{const value=event.target.value;if(value==='__new_space__'){if(!await finishEntry())return;setCreating(true);setError('');setNotice('');}else void selectSpace(value);}} disabled={busy}>{spaces.map(space=><option key={space.id} value={space.id}>{space.name} · @{space.handle}</option>)}<option value="__new_space__" disabled={spaces.length>=MAX_SPACES}>＋ Create a space{spaces.length>=MAX_SPACES?' (limit reached)':''}</option></select></label><span className="space-count">{spaces.length} / {MAX_SPACES} spaces</span></div><div className="workspace-title"><div><div className="eyebrow">HEY, {profile.name.split(' ')[0].toUpperCase()} <span aria-hidden="true"><BrandSpark/></span></div><h1>{{links:'Everywhere you are.',profile:'Make it yours.',chatgpt:'Just say the word.',history:'Nothing lost.'}[tab]}</h1><p>{{links:'Your world, one link at a time.',profile:'A familiar face. A few words. Your kind of color.',chatgpt:'Your next update is a conversation away.',history:'Every change has a way back.'}[tab]}</p></div>{tab==='links'&&<AddItemMenu buttonRef={addLinkButton} busy={busy} contentDisabled={newProfileTab} sectionDisabled={profileLayout.tabs.reduce((count,tab)=>count+tab.sections.length,0)>=20} onAdd={kind=>{addLinkButton.current?.focus({preventScroll:true});edit(kind);}} onSection={()=>changeLayout({...layout,sections:[...layout.sections,{id:crypto.randomUUID(),title:'New section',slugs:[]}]})}/>}</div>{alerts}
    {tab==='links'&&<><div className="workspace-address"><span>wya.im/{profile.handle}</span><button type="button" className="icon-button" aria-label="Copy profile link" title="Copy profile link" onClick={copyLink}><Copy size={14}/></button></div>
      {typeof editing==='string'&&<ItemEditor key={editing} item={editing} handle={profile.handle} existingSlugs={allItems(profile.links).flatMap(link=>[link.slug,...link.aliases??[]])} busy={busy} onSave={save} onClose={closeEditor}/>}
      <ProfileTabEditor layout={profileLayout} activeId={activeProfileTab.id} busy={busy} onChange={changeProfileLayout} onSelect={selectProfileTab}/>
      {layoutInvalid&&<p className="message error" role="status">Give every tab and section a name. Tab URL names must be unique and use lowercase letters, numbers, and hyphens.</p>}
      {newProfileTab&&<p className="tab-draft-hint" role="status">Save layout to create this tab before adding new items. You can move existing items here now.</p>}
      <LayoutEditor key={`${profile.id}:${activeProfileTab.id}`} tabs={profileLayout.tabs} activeTabId={activeProfileTab.id} onTabAssign={(slug,target)=>changeProfileLayout(moveItemToTab(profileLayout,slug,target))} onSectionTabAssign={(sectionId,target)=>changeProfileLayout(moveSectionToTab(profileLayout,sectionId,target))} layout={layout} links={previewProfile!.links} handle={profile.handle} busy={busy} onChange={changeLayout} onEdit={edit} onDelete={requestDelete} editingSlug={typeof editing==='object'?editing?.slug:undefined} renderEditor={()=>editing&&typeof editing==='object'?<>{error&&<p className="message error" role="alert">{error}</p>}<ItemEditor registerAutosave={registerAutosave} item={editing} handle={profile.handle} existingSlugs={allItems(profile.links).flatMap(link=>[link.slug,...link.aliases??[]])} busy={busy} onSave={data=>save(data,true)} onClose={closeEditor}/></>:null}/>
      {layoutChanged&&<div className="order-save-bar"><span role="status">Unsaved layout</span><div><button className="button button-light button-small" disabled={busy} onClick={()=>{discardLayout(profile.id);setError('');}}>Discard</button><button className="button button-dark button-small" disabled={busy||layoutInvalid} onClick={()=>void save({action:'set_tabs',...profileLayout})}>{busy?'Saving…':'Save layout'}<Check size={16}/></button></div></div>}
      {profile.links.length===0&&!editing&&!newProfileTab&&<div className="empty-state"><span>↗</span><h2>Start with your favorite corner.</h2><p>Use Add above to share a link, project, game, or Game Collection.</p></div>}
      <RemoveItemDialog item={deleting} busy={busy} error={error} hasLayoutDraft={layoutChanged}
        onCancel={()=>{setDeleting(null);setError('');}}
        onConfirm={async()=>{if(deleting&&await save({action:'delete_link',slug:deleting.slug}))setDeleting(null);}}
        onReturnFocus={()=>{const target=deleteTrigger.current?.isConnected?deleteTrigger.current:addLinkButton.current;target?.focus({preventScroll:true});}}/>

      </>}
    {tab==='profile'&&<><PictureEditor key={profile.id} profile={profile} busy={busy} onBusy={setBusy} onSaved={updated=>{setProfile(updated);setSpaces(spaces.map(space=>space.id===updated.id?{...space,version:updated.version}:space));}} onConflict={async()=>{const response=await fetch(`/api/account?spaceId=${encodeURIComponent(profile.id)}`);if(response.ok){const fresh=await response.json() as {profile:Profile;history:Revision[];spaces:SpaceSummary[]};setProfile(fresh.profile);setHistory(fresh.history);setSpaces(fresh.spaces);syncLayout(fresh.profile);}}}/><section className="editor-panel"><form key={`${profile.id}:${profile.name}:${profile.bio}:${profile.theme}`} onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await save({action:'update_profile',name:f.get('name'),bio:f.get('bio'),theme:f.get('theme')});}}><label>Display name<input name="name" defaultValue={profile.name} required maxLength={80}/></label><BioEditor initial={profile.bio} disabled={busy}/><fieldset disabled={busy}><legend>Your color</legend><div className="theme-options">{themeIds.map(t=><label className="theme-choice" key={t}><input type="radio" name="theme" value={t} defaultChecked={profile.theme===t}/><span aria-hidden="true" style={{background:profileThemes[t].color}}/>{profileThemes[t].label}</label>)}</div></fieldset><button className="button button-dark" disabled={busy}>{busy?'Saving…':'Save profile'}<Check size={16}/></button></form></section><RenameSpace key={`${profile.id}:${profile.handle}`} profile={profile} busy={busy} onSave={save}/></>}
    {tab==='chatgpt'&&<section className="chat-panel"><div className="chat-panel-symbol"><Sparkles size={32}/></div><h2>Your space. In your own words.</h2><p>Connect wya.im in ChatGPT, then name the space you want to change. Each space has its own profile, links, and history.</p>{standalone ? <><ol><li>Create a custom connection in ChatGPT with <strong>https://wya.im/mcp</strong>.</li><li>Choose OAuth, leave the client ID and secret blank, then sign in with your email code and review access.</li><li>Start a conversation and select wya.im.</li></ol><p className="subtle">Custom connections depend on your ChatGPT account or workspace. Manage access from <Link href="/connections">Your connections</Link>.</p></> : <ol><li>Open ChatGPT’s plugin settings.</li><li>Find <strong>wya.im</strong> in your available plugins and connect it. During this private preview, access is limited to the site owner.</li><li>Start a conversation and mention wya.im.</li></ol>}<div className="prompt-examples"><p>“List my wya.im spaces.”</p><p>“Add my GitHub to my @{profile.handle} space.”</p><p>“Move my portfolio to the top.”</p><p>“Undo my last profile change.”</p></div><p className="subtle">Every update belongs to your signed-in account. You can review and restore previous versions in Change history.</p></section>}
    {tab==='history'&&<section className="history-panel"><p className="history-intro">Version {profile.version} is current. Restore a snapshot from before any change below. Your current state will also be saved. Pictures aren’t included in history.</p>{history.length===0?<div className="empty-state"><History size={32}/><h2>A fresh start.</h2><p>Your changes will appear here after your first update.</p></div>:history.map(rev=><div className="history-row" key={rev.version}><div className="history-dot"><RotateCcw size={17}/></div><div><h3>{rev.reason}</h3><p>{new Date(rev.createdAt).toLocaleString()} · previous version {rev.version}</p></div><button className="button button-small button-light" disabled={busy} onClick={()=>setRestoring(rev)}>Restore before</button></div>)}{restoring&&<div className="confirmation" role="alert"><p>Restore version {restoring.version}? This replaces your current profile details and links.</p><div><button className="button button-dark" disabled={busy} onClick={async()=>{if(await save({action:'restore_revision',revision:restoring.version}))setRestoring(null);}}>Restore version</button><button className="button button-light" disabled={busy} onClick={()=>setRestoring(null)}>Cancel</button></div></div>}</section>}
    <CatalogCredit/></main><aside className="preview-column"><div className="preview-heading"><span>YOUR PAGE</span><a href={`/${profile.handle}`} target="_blank" rel="noreferrer" aria-label="Open your profile"><ArrowUpRight size={17}/></a></div><ProfileCard profile={previewProfile!} preview selectedTab={activeProfileTab.id} onSelectTab={selectProfileTab}/><div className="preview-caption"><span className="status-dot"/>{layoutChanged?'Previewing unsaved layout':'Updates as you save'}</div></aside></div></div>
}
