'use client';
import { lazy, Suspense, useState } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { iconIds, iconLabels, linkPresets, type LinkIconId, type Platform } from '@/lib/link-options';
import { LinkIcon } from '../components/link-icon';

const IconBrowser = lazy(()=>import('./icon-browser'));

export function IconPicker({value,platform,disabled,onChange}:{value:LinkIconId|'';platform:Platform;disabled:boolean;onChange:(value:LinkIconId|'')=>void}) {
  const [open,setOpen] = useState(false);
  function choose(icon:LinkIconId|'') { onChange(icon);setOpen(false); }
  return <fieldset className="icon-picker" disabled={disabled}>
    <legend>Link icon</legend>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <div className="icon-picker-summary">
        <span className="link-icon"><LinkIcon platform={platform} icon={value||undefined}/></span>
        <span className="icon-picker-current"><strong>{value?iconLabels[value]:'Automatic'}</strong><small>{value?'Picked by you.':`${linkPresets[platform].label} preset icon.`}</small></span>
        <Dialog.Trigger asChild><button type="button" className="button button-small button-light" disabled={disabled}>Choose icon</button></Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="icon-dialog-overlay"/>
        <Dialog.Content className="icon-dialog">
          <div className="icon-dialog-heading"><div><span className="eyebrow">A little personality</span><Dialog.Title>Choose your icon</Dialog.Title></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label="Close icon picker"><X size={22}/></button></Dialog.Close></div>
          <Dialog.Description className="icon-dialog-description">{iconIds.length} icons. Find the one that feels like you.</Dialog.Description>
          <Suspense fallback={<p className="icon-loading" role="status">Loading icons…</p>}>
            <IconBrowser value={value} platform={platform} onChoose={choose}/>
          </Suspense>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </fieldset>;
}
