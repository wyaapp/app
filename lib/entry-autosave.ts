export type AutosaveStatus='saved'|'pending'|'saving'|'invalid'|'error';
type Payload=Record<string,unknown>;

/** Serial, debounced writes. Failed snapshots require an edit or explicit retry. */
export class EntryAutosave {
  private current:string;
  private saved:string;
  private failed:string|null=null;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private running:Promise<boolean>|null=null;
  private blocked=false;
  private options:{save:(data:Payload)=>Promise<boolean>;valid:()=>boolean;status:(status:AutosaveStatus)=>void;delay?:number};
  constructor(initial:Payload,options:EntryAutosave['options']) {
    this.options=options;
    this.current=this.saved=JSON.stringify(initial);
  }
  configure(options:Pick<typeof this.options,'save'|'valid'>){Object.assign(this.options,options);}
  get dirty(){return this.current!==this.saved;}
  update(data:Payload,blocked=false) {
    const value=JSON.stringify(data),changed=value!==this.current;
    this.blocked=blocked;
    if(changed){this.current=value;this.failed=null;}
    this.cancel();
    if(this.running)return;
    if(!this.dirty){this.options.status('saved');return;}
    if(this.failed===this.current){this.options.status('error');return;}
    if(!this.options.valid()){this.options.status('invalid');return;}
    this.options.status('pending');
    if(!blocked)this.timer=setTimeout(()=>void this.flush(),this.options.delay??1500);
  }
  discard(){if(this.running)return false;this.cancel();this.current=this.saved;this.failed=null;this.options.status('saved');return true;}
  cancel(){clearTimeout(this.timer);this.timer=undefined;}
  async flush():Promise<boolean> {
    this.cancel();
    if(this.running){if(!await this.running)return false;return this.flush();}
    if(!this.dirty)return true;
    if(this.blocked)return false;
    if(!this.options.valid()){this.options.status('invalid');return false;}
    const snapshot=this.current;
    this.options.status('saving');
    this.running=(async()=>{
      let success=false;
      try{success=await this.options.save(JSON.parse(snapshot) as Payload);}catch{success=false;}
      if(success){this.saved=snapshot;this.failed=null;}else this.failed=snapshot;
      return success;
    })();
    const success=await this.running;
    this.running=null;
    this.update(JSON.parse(this.current) as Payload,this.blocked);
    return success&&!this.dirty;
  }
}
