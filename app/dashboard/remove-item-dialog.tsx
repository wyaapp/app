'use client';
import {AlertDialog} from 'radix-ui';
import type {LinkItem} from '@/lib/model';

export function RemoveItemDialog({item,busy,error,hasLayoutDraft,onCancel,onConfirm,onReturnFocus}:{
  item:LinkItem|null;busy:boolean;error:string;hasLayoutDraft:boolean;
  onCancel:()=>void;onConfirm:()=>Promise<void>;onReturnFocus:()=>void;
}) {
  const kind=item?.kind==='project'?'project':'link';
  return <AlertDialog.Root open={Boolean(item)} onOpenChange={open=>{if(!open&&!busy)onCancel();}}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="icon-dialog-overlay"/>
      <AlertDialog.Content className="icon-dialog remove-item-dialog"
        onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}
        onCloseAutoFocus={event=>{event.preventDefault();onReturnFocus();}}>
        <AlertDialog.Title>Remove {kind}?</AlertDialog.Title>
        <AlertDialog.Description>
          <strong>{item?.label}</strong> will be removed from your profile, and its short URL and aliases will stop working. You can restore it from history.
          {hasLayoutDraft&&<span className="remove-item-draft-note">Your other layout changes will stay unsaved. You can save or discard them afterward.</span>}
        </AlertDialog.Description>
        {error&&<p className="message error" role="alert">{error}</p>}
        <div className="remove-item-actions">
          <AlertDialog.Cancel asChild><button type="button" className="button button-light" disabled={busy}>Keep it</button></AlertDialog.Cancel>
          <button type="button" className="button button-danger" disabled={busy} onClick={()=>void onConfirm()}>{busy?'Removing…':`Remove ${kind}`}</button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
