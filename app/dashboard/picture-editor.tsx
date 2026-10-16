'use client';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Camera, Check, RotateCw, Trash2, X } from 'lucide-react';
import { ProfileAvatar } from '../components/profile-avatar';
import type { Profile } from '@/lib/model';
import { MAX_PICTURE_BYTES, PICTURE_SIZE, PICTURE_TYPES } from '@/lib/picture-limits';
import { cropGeometry, drawPicture, initialCrop, type PictureCrop } from '@/lib/picture-crop';

export function PictureEditor({profile,busy,onBusy,onSaved,onConflict}:{profile:Profile;busy:boolean;onBusy:(value:boolean)=>void;onSaved:(profile:Profile)=>void;onConflict:()=>Promise<void>}) {
  const input=useRef<HTMLInputElement>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const selection=useRef(0);
  const [image,setImage]=useState<ImageBitmap|null>(null);
  const [crop,setCrop]=useState<PictureCrop>(initialCrop);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(false);
  const [removing,setRemoving]=useState(false);
  const dragging=useRef<{x:number;y:number;crop:PictureCrop}|null>(null);
  useEffect(()=>()=>{selection.current++;},[]);
  useEffect(()=>()=>image?.close(),[image]);
  useEffect(()=>{if(canvas.current && image) drawPicture(canvas.current,image,crop);},[image,crop]);
  async function choose(file?:File) {
    if(!file) return;
    const id=++selection.current;
    setError('');setNotice('');setRemoving(false);
    if(file.size>MAX_PICTURE_BYTES) {setError('Choose a picture of 5 MB or less.');return;}
    if(!PICTURE_TYPES.some(type=>type===file.type)) {setError('Choose a JPEG, PNG, or WebP picture.');return;}
    setLoading(true);
    try {
      const decoded=await createImageBitmap(file,{imageOrientation:'from-image'});
      if(selection.current!==id) {decoded.close();return;}
      if(decoded.width*decoded.height>40_000_000) {decoded.close();throw new Error('This picture is too large to edit. Choose one under 40 megapixels.');}
      setCrop(initialCrop);setImage(decoded);
    } catch(err) {if(selection.current===id) setError(err instanceof Error && err.message.includes('megapixels') ? err.message : 'This picture could not be opened. Try a JPEG, PNG, or WebP file.');}
    finally {if(selection.current===id) setLoading(false);}
  }
  async function save(remove=false) {
    if(busy) return;
    onBusy(true);setError('');setNotice('');
    try {
      let blob:Blob|undefined;
      if(!remove) {
        if(!image) throw new Error('Choose a picture first.');
        const output=document.createElement('canvas');
        output.width=output.height=PICTURE_SIZE;
        drawPicture(output,image,crop);
        blob=await new Promise<Blob>((resolve,reject)=>output.toBlob(b=>b ? resolve(b) : reject(new Error('Could not prepare this picture.')),'image/webp',0.85));
        if(blob.size>MAX_PICTURE_BYTES) throw new Error('The prepared picture exceeds 5 MB. Choose another file.');
      }
      const params=new URLSearchParams({spaceId:profile.id,expectedVersion:String(profile.version)});
      const response=await fetch(`/api/pictures?${params}`,{method:remove?'DELETE':'PUT',...(blob?{headers:{'Content-Type':blob.type},body:blob}:{})});
      const result=await response.json() as {profile:Profile;error?:string};
      if(!response.ok) {
        if(response.status===409) await onConflict();
        throw new Error(result.error || 'Could not save your picture.');
      }
      onSaved(result.profile);setImage(null);setRemoving(false);
      setNotice(remove ? 'Picture removed.' : 'Picture saved. Your page is up to date.');
    } catch(err) {setError(err instanceof Error ? err.message : 'Could not save your picture.');}
    finally {onBusy(false);}
  }
  const close=()=>{if(!busy){setImage(null);setError('');}};
  return <section className="editor-panel picture-panel" aria-labelledby="picture-heading">
    <div className="picture-summary"><ProfileAvatar name={profile.name} url={profile.pictureUrl}/><div><h2 id="picture-heading">Your picture</h2><p>A face, a logo, a little you. Just for @{profile.handle}.</p></div></div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Choose profile picture" onChange={e=>{void choose(e.target.files?.[0]);e.target.value='';}}/>
    <div className="picture-actions"><button type="button" className="button button-light" disabled={busy||loading} onClick={()=>input.current?.click()}><Camera size={17}/>{loading?'Opening…':profile.pictureUrl?'Change picture':'Add a picture'}</button>{profile.pictureUrl&&<button type="button" className="button button-small button-light" disabled={busy||loading} onClick={()=>{setRemoving(true);setError('');setNotice('');}}><Trash2 size={15}/>Remove</button>}</div>
    <p className="subtle">JPEG, PNG, or WebP · up to 5 MB. Crop and preview before saving.</p>
    {removing&&<div className="confirmation"><p>Remove this picture? Your initials will take its place. Pictures aren’t saved in history.</p><div><button className="button button-danger" disabled={busy} onClick={()=>void save(true)}>Remove picture</button><button className="button button-light" disabled={busy} onClick={()=>setRemoving(false)}>Keep it</button></div></div>}
    {!image&&error&&<p className="message error" role="alert">{error}</p>}
    {notice&&<p className="message success" role="status"><Check size={16}/>{notice}</p>}
    <Dialog.Root open={Boolean(image)} onOpenChange={open=>{if(!open)close();}}><Dialog.Portal><Dialog.Overlay className="icon-dialog-overlay"/><Dialog.Content className="icon-dialog picture-dialog" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>{if(busy)e.preventDefault();}}>
      <div className="icon-dialog-heading"><Dialog.Title>Find your good side.</Dialog.Title><button className="icon-button" aria-label="Cancel picture edit" disabled={busy} onClick={close}><X size={20}/></button></div>
      <Dialog.Description className="icon-dialog-description">Drag to frame your picture, or use the sliders. Nothing changes until you save.</Dialog.Description>
      <div className="picture-crop-body"><div className="picture-crop-frame"><canvas ref={node=>{canvas.current=node;if(node && image)drawPicture(node,image,crop);}} width={PICTURE_SIZE} height={PICTURE_SIZE} aria-label="Picture crop preview" onPointerDown={e=>{if(busy)return;e.currentTarget.setPointerCapture(e.pointerId);dragging.current={x:e.clientX,y:e.clientY,crop};}} onPointerUp={()=>{dragging.current=null;}} onPointerCancel={()=>{dragging.current=null;}} onPointerMove={e=>{
        const drag=dragging.current;if(!drag||!image||busy)return;
        const g=cropGeometry(image.width,image.height,drag.crop,e.currentTarget.getBoundingClientRect().width);
        const clamp=(value:number)=>Math.max(-1,Math.min(1,value));
        setCrop({...drag.crop,x:g.overflowX ? clamp(drag.crop.x+(e.clientX-drag.x)/g.overflowX) : 0,y:g.overflowY ? clamp(drag.crop.y+(e.clientY-drag.y)/g.overflowY) : 0});
      }}/><div className="picture-crop-mask"/></div>
      <div className="picture-sliders"><label>Zoom<input type="range" min={1} max={3} step={0.01} value={crop.zoom} disabled={busy} onChange={e=>setCrop({...crop,zoom:Number(e.target.value)})}/></label><label>Horizontal position<input type="range" min={-1} max={1} step={0.01} value={crop.x} disabled={busy} onChange={e=>setCrop({...crop,x:Number(e.target.value)})}/></label><label>Vertical position<input type="range" min={-1} max={1} step={0.01} value={crop.y} disabled={busy} onChange={e=>setCrop({...crop,y:Number(e.target.value)})}/></label><button className="button button-small button-light" disabled={busy} onClick={()=>setCrop({...initialCrop,rotation:(crop.rotation+90)%360})}><RotateCw size={16}/>Rotate</button></div>
      {error&&<p className="message error" role="alert">{error}</p>}</div>
      <div className="picture-footer"><button className="button button-light" disabled={busy} onClick={close}>Cancel</button><button className="button button-dark" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save picture'}<Check size={16}/></button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
