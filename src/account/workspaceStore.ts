export type WorkspaceDocument={revision:number;storage:Record<string,string>};
export class WorkspaceStore {
  owner='';revision=0;error='';private values=new Map<string,string>();private generation=0;private saved=0;private epoch=0;
  private timer:ReturnType<typeof setTimeout>|undefined;private running:Promise<void>|null=null;private listeners=new Set<()=>void>();
  private persist:(owner:string,document:WorkspaceDocument)=>Promise<{revision:number}>;
  constructor(persist:(owner:string,document:WorkspaceDocument)=>Promise<{revision:number}>){this.persist=persist;}
  get dirty(){return this.generation!==this.saved;}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private notify(){for(const listener of this.listeners)listener();}
  reset(owner='',document:WorkspaceDocument={revision:0,storage:{}}){clearTimeout(this.timer);this.epoch++;this.owner=owner;this.revision=document.revision;this.values=new Map(Object.entries(document.storage));this.generation=0;this.saved=0;this.error='';this.running=null;this.notify();}
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){if(!this.owner)throw new Error('LOGIN_REQUIRED');if(this.getItem(key)===value)return;this.values.set(key,value);this.changed();}
  removeItem(key:string){if(!this.owner)throw new Error('LOGIN_REQUIRED');if(this.values.delete(key))this.changed();}
  private changed(){this.generation++;this.notify();clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush().catch(()=>{}),250);}
  snapshot(){return Object.fromEntries(this.values);}
  async flush():Promise<void>{
    clearTimeout(this.timer);
    if(this.running){await this.running;if(this.dirty)return this.flush();return;}
    if(!this.dirty)return;
    const epoch=this.epoch,owner=this.owner;
    const task=async()=>{try{while(this.dirty&&epoch===this.epoch){const generation=this.generation;const response=await this.persist(owner,{revision:this.revision,storage:this.snapshot()});if(epoch!==this.epoch)return;this.revision=response.revision;this.saved=generation;this.error='';this.notify();}}catch(error){if(epoch===this.epoch){this.error=error instanceof Error?error.message:'SAVE_FAILED';this.notify();}throw error;}finally{if(epoch===this.epoch)this.running=null;}};
    this.running=task();await this.running;
  }
}
