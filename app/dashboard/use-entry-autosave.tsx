'use client';
import {createContext,useContext,useEffect,useState,type RefObject} from 'react';
import {EntryAutosave,type AutosaveStatus} from '@/lib/entry-autosave';

export type FlushEntry=()=>Promise<boolean>;
export const EntryAutosaveContext=createContext<((flush:FlushEntry|null)=>void)|null>(null);

export function useEntryAutosave({enabled,payload,busy,form,onSave,valid=true}:{valid?:boolean;enabled:boolean;payload:Record<string,unknown>;busy:boolean;form:RefObject<HTMLFormElement|null>;onSave:(data:Record<string,unknown>)=>Promise<boolean>}) {
  const register=useContext(EntryAutosaveContext);
  const [status,setStatus]=useState<AutosaveStatus>('saved');
  const [queue]=useState(()=>new EntryAutosave(payload,{
    save:async()=>false,valid:()=>false,
    status:setStatus,
  }));
  const serialized=JSON.stringify(payload);
  useEffect(()=>{queue.configure({save:onSave,valid:()=>valid&&!!form.current&&Array.from(form.current.elements).every(element=>!('validity' in element)||(element as HTMLInputElement).validity.valid)});});
  useEffect(()=>{
    if(enabled)queue.update(JSON.parse(serialized),busy);
    return ()=>queue.cancel();
  },[enabled,serialized,busy,queue]);
  useEffect(()=>{
    if(!enabled)return;
    register?.(async()=>{const saved=await queue.flush();if(!saved)form.current?.reportValidity();return saved;});
    const warn=(event:BeforeUnloadEvent)=>{if(queue.dirty){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',warn);
    return ()=>{register?.(null);queue.cancel();window.removeEventListener('beforeunload',warn);};
  },[enabled,register,queue,form]);
  return {status,flush:()=>queue.flush(),discard:()=>queue.discard()};
}

export function EntrySaveStatus({status,onRetry,onDiscard}:{status:AutosaveStatus;onRetry:()=>void;onDiscard:()=>void}) {
  return <div className="entry-save-status" role="status"><span>{{saved:'All changes saved',pending:'Unsaved changes…',saving:'Saving…',invalid:'Complete the fields to save',error:'Changes not saved'}[status]}</span>{status==='error'&&<button type="button" className="text-link" onClick={onRetry}>Retry</button>}{(status==='invalid'||status==='error'||status==='pending')&&<button type="button" className="text-link" onClick={onDiscard}>Discard unsaved</button>}</div>;
}
