import { WorkspaceStore } from './workspaceStore.ts';
export const ACCOUNT_MODE=import.meta.env?.MODE==='account-lab'&&import.meta.env?.VITE_ACCOUNT_LAB==='1';
export const ACCOUNT_ORIGIN='http://127.0.0.1:8790';
export async function accountRequest(path:string,init:RequestInit={},owner=workspace.owner){
  if(!ACCOUNT_MODE||location.origin!==ACCOUNT_ORIGIN||!path.startsWith('/api/')||!owner)throw new Error('ACCOUNT_TEST_ONLY');
  const response=await fetch(path,{...init,credentials:'same-origin',headers:{...init.headers,'x-yami-user':owner}});
  if(response.status===401){window.dispatchEvent(new Event('yami-account-expired'));throw new Error('LOGIN_REQUIRED');}
  if(owner!==workspace.owner)throw new Error('ACCOUNT_CHANGED');
  if(!response.ok){const error=await response.json().catch(()=>({error:'REQUEST_FAILED'}));throw new Error(error.error||'REQUEST_FAILED');}
  return response;
}
export const workspace=new WorkspaceStore(async(owner,document)=>{
  const response=await accountRequest('/api/workspace',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(document)},owner);
  return response.json();
});
export const workspaceStorage={
  getItem(key:string){return ACCOUNT_MODE?workspace.getItem(key):globalThis.localStorage.getItem(key);},
  setItem(key:string,value:string){if(ACCOUNT_MODE)workspace.setItem(key,value);else globalThis.localStorage.setItem(key,value);},
  removeItem(key:string){if(ACCOUNT_MODE)workspace.removeItem(key);else globalThis.localStorage.removeItem(key);}
};
export function storageForOwner(owner?:string){
  const check=()=>{if(ACCOUNT_MODE&&(!owner||workspace.owner!==owner))throw new Error('ACCOUNT_CHANGED');};
  return {getItem(key:string){check();return workspaceStorage.getItem(key);},setItem(key:string,value:string){check();workspaceStorage.setItem(key,value);},removeItem(key:string){check();workspaceStorage.removeItem(key);}};
}
export async function accountFile(kind:'attachments'|'backups',id:string,method='GET',body?:BodyInit,media='application/octet-stream'){
  return accountRequest(`/api/files/${kind}/${encodeURIComponent(id)}`,{method,...(body!==undefined?{body,headers:{'content-type':media}}:{})});
}
