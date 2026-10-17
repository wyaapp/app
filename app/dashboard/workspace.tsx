'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Plus, Check, Copy, Sparkles, History, Link2, UserRound, RotateCcw } from 'lucide-react';
import { Brand } from '../components/brand';
import { BrandSpark } from '../components/brand-spark';
import { ProfileCard } from '../components/profile-card';
import { type Profile, type Revision, type LinkItem, type SpaceSummary, MAX_SPACES } from '@/lib/model';
import { LinkList } from './link-list';
import { PictureEditor } from './picture-editor';
import { BioEditor } from './bio-editor';
import { themeIds, profileThemes } from '@/lib/profile-themes';
import { LinkEditor } from './link-editor';
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
  const [editing,setEditing] = useState<LinkItem | 'new' | null>(null);
  const [deleting,setDeleting] = useState<LinkItem | null>(null);
  const [restoring,setRestoring] = useState<Revision | null>(null);
  const [orders,setOrders] = useState<Record<string,string[]>>({});
  // Keep drafts per space and reconcile against current links after edits/conflicts.
  const draft = profile ? orders[profile.id] : undefined;
  const orderedLinks = profile ? [
    ...(draft ?? []).flatMap(slug=>profile.links.find(link=>link.slug===slug) ?? []),
    ...profile.links.filter(link=>!draft?.includes(link.slug)),
  ] : [];
  const orderChanged = !!profile && orderedLinks.some((link,index)=>link.slug!==profile.links[index]?.slug);
  useEffect(()=>{
    if(!Object.keys(orders).length) return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[orders]);
  function discardOrder(id:string) {
    setOrders(current=>{const next={...current};delete next[id];return next;});
  }
  function clearUnchangedOrder(updated:Profile) {
    const draft=orders[updated.id];
    if(!draft) return;
    const slugs=[...draft.filter(slug=>updated.links.some(link=>link.slug===slug)),...updated.links.filter(link=>!draft.includes(link.slug)).map(link=>link.slug)];
    if(slugs.every((slug,index)=>slug===updated.links[index]?.slug)) discardOrder(updated.id);
  }
  async function save(data:Record<string,unknown>) {
    if(busy) return false;
    setBusy(true);setError('');setNotice('');
    try {
      const response = await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,...(profile&&data.action!=='create_profile'?{spaceId:profile.id,expectedVersion:profile.version}:{})})});
      const result = await response.json() as {profile:Profile;spaces:SpaceSummary[];history:Revision[];error?:string};
      if(!response.ok) {
        if(response.status===409 && profile) { const fresh=await fetch(`/api/account?spaceId=${encodeURIComponent(profile.id)}`).then(r=>r.json()) as {profile:Profile;spaces:SpaceSummary[];history:Revision[]}; if(fresh.profile?.id===profile.id) {setProfile(fresh.profile);setHistory(fresh.history);setSpaces(fresh.spaces);clearUnchangedOrder(fresh.profile);} }
        throw new Error(result.error || 'Could not save your changes.');
      }
      setProfile(result.profile);setHistory(result.history);setSpaces(result.spaces);
      if(data.action==='reorder_links' || data.action==='restore_revision') discardOrder(result.profile.id);
      else if(data.action==='upsert_link' && typeof data.originalSlug==='string' && typeof data.slug==='string' && data.originalSlug!==data.slug) {
        const originalSlug=data.originalSlug;
        const slug=data.slug.trim().toLowerCase();
        setOrders(current=>current[result.profile.id] ? {...current,[result.profile.id]:current[result.profile.id].map(item=>item===originalSlug?slug:item)} : current);
      } else clearUnchangedOrder(result.profile);
      window.history.replaceState(null,'',`/dashboard?space=${encodeURIComponent(result.profile.id)}`);
      if(data.action==='create_profile'){setCreating(false);setTab('links');setEditing(null);setDeleting(null);setRestoring(null);}
      setNotice('Saved. Your space is up to date.');return true;
    } catch(err){setError(err instanceof Error?err.message:'Could not save your changes.');return false;}
    finally{setBusy(false);}
  }
  async function copyLink(){try{await navigator.clipboard.writeText(`${window.location.origin}/${profile!.handle}`);setNotice('Profile link copied.');}catch{setError('Copy failed. Open your profile and copy its address.');}}
  function edit(link:LinkItem|'new'){setEditing(link);setDeleting(null);setError('');}
  function move(from:number,to:number) {
    if(!profile || busy) return;
    const links=[...orderedLinks];
    const [link]=links.splice(from,1);links.splice(to,0,link);
    if(links.every((item,index)=>item.slug===profile.links[index]?.slug)) discardOrder(profile.id);
    else setOrders(current=>({...current,[profile.id]:links.map(item=>item.slug)}));
    setNotice('');
  }
  const alerts = <div className="messages" aria-live="polite">{error&&<div className="message error" role="alert">{error}</div>}{notice&&<div className="message success"><Check size={16}/>{notice}</div>}</div>;
  async function selectSpace(id:string) {
    if(busy || id===profile?.id) return;
    setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch(`/api/account?spaceId=${encodeURIComponent(id)}`);
      const result=await response.json() as {profile:Profile;spaces:SpaceSummary[];history:Revision[];error?:string};
      if(!response.ok) throw new Error(result.error || 'Could not load this space.');
      setProfile(result.profile);setSpaces(result.spaces);setHistory(result.history);clearUnchangedOrder(result.profile);
      setEditing(null);setDeleting(null);setRestoring(null);setTab('links');
      window.history.replaceState(null,'',`/dashboard?space=${encodeURIComponent(id)}`);
    } catch(error){setError(error instanceof Error?error.message:'Could not load this space.');}
    finally{setBusy(false);}
  }
  if(!profile || creating) return <div className="site-shell"><header className="site-header"><Brand/><a className="text-link" href={signOut} target="_top">Sign out</a></header><div className="creation-messages">{alerts}</div><CreateSpace count={spaces.length} busy={busy} displayName={displayName} onSave={save} onCancel={profile?()=>setCreating(false):undefined}/></div>;

  return <div className="workspace-shell"><header className="workspace-header"><Brand/><div className="workspace-header-right"><a href={`/${profile.handle}`} target="_blank" rel="noreferrer" className="text-link">Visit your page <ArrowUpRight size={15}/></a>{standalone && <Link className="text-link" href="/connections">Connections</Link>}<a href={signOut} target="_top" className="user-chip" title="Sign out">{profile.name.charAt(0).toUpperCase()}</a></div></header><div className="workspace-grid"><aside className="sidebar"><div className="sidebar-label">YOUR CONTROL ROOM</div><nav>{([{key:'links',label:'Your links',icon:Link2},{key:'profile',label:'Your profile',icon:UserRound},{key:'chatgpt',label:'Use ChatGPT',icon:Sparkles},{key:'history',label:'Change history',icon:History}] as const).map(item=><button key={item.key} disabled={busy} className={tab===item.key?'active':''} onClick={()=>{setTab(item.key);setEditing(null);setError('');setNotice('');}}><item.icon size={18}/>{item.label}{item.key==='chatgpt'&&<span className="new-tag">NEW</span>}</button>)}</nav><div className="sidebar-bottom"><span className="little-spark"><BrandSpark/></span><p>One address.<br/>All of you.</p><span>wya.im/{profile.handle}</span></div></aside><main className="workspace-main"><div className="space-switcher"><label>Your spaces <select value={profile.id} onChange={e=>void selectSpace(e.target.value)} disabled={busy}>{spaces.map(space=><option key={space.id} value={space.id}>{space.name} · @{space.handle}</option>)}</select></label><div><span>{spaces.length} / {MAX_SPACES} spaces</span><button className="button button-small button-light" disabled={busy||spaces.length>=MAX_SPACES} onClick={()=>{setCreating(true);setError('');setNotice('');}}><Plus size={15}/>New space</button></div></div><div className="workspace-title"><div><div className="eyebrow">HEY, {profile.name.split(' ')[0].toUpperCase()} <span aria-hidden="true"><BrandSpark/></span></div><h1>{{links:'Everywhere you are.',profile:'Make it yours.',chatgpt:'Just say the word.',history:'Nothing lost.'}[tab]}</h1><p>{{links:'Your world, one link at a time.',profile:'A familiar face. A few words. Your kind of color.',chatgpt:'Your next update is a conversation away.',history:'Every change has a way back.'}[tab]}</p></div>{tab==='links'&&<button className="button button-dark" onClick={()=>edit('new')} disabled={busy}><Plus size={17}/>Add a link</button>}</div>{alerts}
    {tab==='links'&&<><div className="address-bar"><span><span className="status-dot"/> Your address <strong>wya.im/{profile.handle}</strong></span><button className="icon-button" aria-label="Copy profile link" onClick={copyLink}><Copy size={17}/></button></div>
      {editing&&<LinkEditor key={editing==='new'?'new':editing.slug} link={editing} handle={profile.handle} existingSlugs={profile.links.map(link=>link.slug)} busy={busy} onSave={save} onClose={()=>setEditing(null)}/>}
      {profile.links.length>1&&<p className="reorder-help">Drag the handles or use the arrows, then save your order.</p>}
      <LinkList key={profile.id} links={orderedLinks} handle={profile.handle} busy={busy} onMove={move} onEdit={edit} onDelete={setDeleting}/>
      {orderChanged&&<div className="order-save-bar"><span role="status">Unsaved link order</span><div><button className="button button-light button-small" disabled={busy} onClick={()=>{discardOrder(profile.id);setError('');}}>Discard</button><button className="button button-dark button-small" disabled={busy} onClick={()=>void save({action:'reorder_links',slugs:orderedLinks.map(link=>link.slug)})}>{busy?'Saving…':'Save order'}<Check size={16}/></button></div></div>}
      {profile.links.length===0&&!editing&&<div className="empty-state"><span>↗</span><h2>Start with your favorite corner.</h2><p>Add your GitHub, Instagram, website, or anywhere you call home.</p><button className="button button-light" onClick={()=>edit('new')}><Plus size={16}/>Add your first link</button></div>}
      {deleting&&<div className="confirmation" role="alert"><p>Remove <strong>{deleting.label}</strong>? Its short link will stop working. You can restore it from history.</p><div><button className="button button-danger" disabled={busy} onClick={async()=>{if(await save({action:'delete_link',slug:deleting.slug}))setDeleting(null);}}>Remove link</button><button className="button button-light" disabled={busy} onClick={()=>setDeleting(null)}>Keep it</button></div></div>}
      <button className="chat-nudge" onClick={()=>setTab('chatgpt')}><Sparkles size={22}/><span><strong>Say it. Update it.</strong><small>“Add my GitHub.” Manage your links in ChatGPT.</small></span><ArrowUpRight size={19}/></button></>}
    {tab==='profile'&&<><PictureEditor key={profile.id} profile={profile} busy={busy} onBusy={setBusy} onSaved={updated=>{setProfile(updated);setSpaces(spaces.map(space=>space.id===updated.id?{...space,version:updated.version}:space));}} onConflict={async()=>{const response=await fetch(`/api/account?spaceId=${encodeURIComponent(profile.id)}`);if(response.ok){const fresh=await response.json() as {profile:Profile;history:Revision[];spaces:SpaceSummary[]};setProfile(fresh.profile);setHistory(fresh.history);setSpaces(fresh.spaces);clearUnchangedOrder(fresh.profile);}}}/><section className="editor-panel"><form key={`${profile.id}:${profile.name}:${profile.bio}:${profile.theme}`} onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await save({action:'update_profile',name:f.get('name'),bio:f.get('bio'),theme:f.get('theme')});}}><label>Display name<input name="name" defaultValue={profile.name} required maxLength={80}/></label><BioEditor initial={profile.bio} disabled={busy}/><fieldset disabled={busy}><legend>Your color</legend><div className="theme-options">{themeIds.map(t=><label className="theme-choice" key={t}><input type="radio" name="theme" value={t} defaultChecked={profile.theme===t}/><span aria-hidden="true" style={{background:profileThemes[t].color}}/>{profileThemes[t].label}</label>)}</div></fieldset><button className="button button-dark" disabled={busy}>{busy?'Saving…':'Save profile'}<Check size={16}/></button></form></section><RenameSpace key={`${profile.id}:${profile.handle}`} profile={profile} busy={busy} onSave={save}/></>}
    {tab==='chatgpt'&&<section className="chat-panel"><div className="chat-panel-symbol"><Sparkles size={32}/></div><h2>Your space. In your own words.</h2><p>Connect wya.im in ChatGPT, then name the space you want to change. Each space has its own profile, links, and history.</p>{standalone ? <><ol><li>Create a custom connection in ChatGPT with <strong>https://wya.im/mcp</strong>.</li><li>Choose OAuth, leave the client ID and secret blank, then sign in with your email code and review access.</li><li>Start a conversation and select wya.im.</li></ol><p className="subtle">Custom connections depend on your ChatGPT account or workspace. Manage access from <Link href="/connections">Your connections</Link>.</p></> : <ol><li>Open ChatGPT’s plugin settings.</li><li>Find <strong>wya.im</strong> in your available plugins and connect it. During this private preview, access is limited to the site owner.</li><li>Start a conversation and mention wya.im.</li></ol>}<div className="prompt-examples"><p>“List my wya.im spaces.”</p><p>“Add my GitHub to my @{profile.handle} space.”</p><p>“Move my portfolio to the top.”</p><p>“Undo my last profile change.”</p></div><p className="subtle">Every update belongs to your signed-in account. You can review and restore previous versions in Change history.</p></section>}
    {tab==='history'&&<section className="history-panel"><p className="history-intro">Version {profile.version} is current. Restore a snapshot from before any change below. Your current state will also be saved. Pictures aren’t included in history.</p>{history.length===0?<div className="empty-state"><History size={32}/><h2>A fresh start.</h2><p>Your changes will appear here after your first update.</p></div>:history.map(rev=><div className="history-row" key={rev.version}><div className="history-dot"><RotateCcw size={17}/></div><div><h3>{rev.reason}</h3><p>{new Date(rev.createdAt).toLocaleString()} · previous version {rev.version}</p></div><button className="button button-small button-light" disabled={busy} onClick={()=>setRestoring(rev)}>Restore before</button></div>)}{restoring&&<div className="confirmation" role="alert"><p>Restore version {restoring.version}? This replaces your current profile details and links.</p><div><button className="button button-dark" disabled={busy} onClick={async()=>{if(await save({action:'restore_revision',revision:restoring.version}))setRestoring(null);}}>Restore version</button><button className="button button-light" disabled={busy} onClick={()=>setRestoring(null)}>Cancel</button></div></div>}</section>}
    </main><aside className="preview-column"><div className="preview-heading"><span>YOUR PAGE</span><a href={`/${profile.handle}`} target="_blank" rel="noreferrer" aria-label="Open your profile"><ArrowUpRight size={17}/></a></div><ProfileCard profile={{...profile,links:orderedLinks}} preview/><div className="preview-caption"><span className="status-dot"/>{orderChanged?'Previewing unsaved order':'Updates as you save'}</div></aside></div></div>
}
