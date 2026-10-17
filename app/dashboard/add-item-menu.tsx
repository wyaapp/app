'use client';
import type {Ref} from 'react';
import {DropdownMenu} from 'radix-ui';
import {ChevronDown,Folder,Gamepad2,Link2,List,Plus} from 'lucide-react';

export function AddItemMenu({buttonRef,busy,contentDisabled,sectionDisabled,onAdd,onSection}:{
  buttonRef:Ref<HTMLButtonElement>;busy:boolean;contentDisabled:boolean;sectionDisabled:boolean;
  onAdd:(kind:'new'|'new-project'|'new-interest')=>void;onSection:()=>void;
}) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button ref={buttonRef} type="button" className="button button-dark add-content-trigger" disabled={busy}><Plus size={18}/>Add<ChevronDown size={15}/></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="add-content-menu" align="end" sideOffset={8} collisionPadding={12} aria-label="Add to your page">
      <DropdownMenu.Item disabled={contentDisabled} onSelect={()=>onAdd('new')}><Link2 size={18}/><span><strong>Link</strong><small>A place to find you</small></span></DropdownMenu.Item>
      <DropdownMenu.Item disabled={contentDisabled} onSelect={()=>onAdd('new-project')}><Folder size={18}/><span><strong>Project</strong><small>Something you made</small></span></DropdownMenu.Item>
      <DropdownMenu.Item disabled={contentDisabled} onSelect={()=>onAdd('new-interest')}><Gamepad2 size={18}/><span><strong>Game</strong><small>Something you play</small></span></DropdownMenu.Item>
      <DropdownMenu.Separator/>
      <DropdownMenu.Item disabled={sectionDisabled} onSelect={onSection}><List size={18}/><span><strong>Section</strong><small>Group items under a heading</small></span></DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
