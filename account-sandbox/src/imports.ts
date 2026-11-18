import { AuthError, LOCAL_ORIGIN } from './auth';

const keys = new Set(['career-flow-data-v5','careerflow-theme','careerflow-last-manual-theme','careerflow-locale','careerflow-custom-icon','yami-last-main-view','careerflow-home-region','careerflow-company-stage-filter','careerflow-company-sort','careerflow-last-export','yami-product-update-read-ids']);
const arrays = ['companies','events','materials','interviews','preparations','templates'] as const;
type Kind = 'attachments'|'backups';
type ManifestFile = {kind:Kind;id:string;size:number;sha256:string};
type D1 = D1Database;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value as object).sort().map(key=>`${JSON.stringify(key)}:${stable((value as Record<string,unknown>)[key])}`).join(',')}}`:JSON.stringify(value);
const sha256=async(value:Uint8Array|string)=>{const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(part=>part.toString(16).padStart(2,'0')).join('');};
async function bodyBytes(request:Request,limit=1_000_000){
  const length=Number(request.headers.get('content-length')??0);if(length>limit)throw new AuthError('LOCAL_TEST_BODY_LIMIT',413);
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();const parts:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new AuthError('LOCAL_TEST_BODY_LIMIT',413);}parts.push(value);}}
  finally{reader.releaseLock();}
  const output=new Uint8Array(size);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.byteLength;}return output;
}
function parseManifest(value:unknown):ManifestFile[]{
  if(!Array.isArray(value)||value.length>2000)throw new AuthError('INVALID_IMPORT_MANIFEST');
  const seen=new Set<string>();
  return value.map((entry)=>{
    if(!entry||typeof entry!=='object')throw new AuthError('INVALID_IMPORT_MANIFEST');
    const item=entry as Record<string,unknown>;
    if((item.kind!=='attachments'&&item.kind!=='backups')||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(item.id)||!Number.isSafeInteger(item.size)||(item.size as number)<0||(item.size as number)>1_000_000||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256))throw new AuthError('INVALID_IMPORT_MANIFEST');
    const compound=`${item.kind}/${item.id}`;if(seen.has(compound))throw new AuthError('DUPLICATE_IMPORT_FILE');seen.add(compound);
    return {kind:item.kind,id:item.id,size:item.size as number,sha256:item.sha256};
  });
}
function validateIncomingStorage(value:unknown):Record<string,string>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AuthError('INVALID_IMPORT_STORAGE');
  const storage=value as Record<string,unknown>;
  for(const [key,item] of Object.entries(storage))if(!keys.has(key)||typeof item!=='string')throw new AuthError('INVALID_STORAGE_KEY');
  const record=storage['career-flow-data-v5'];if(typeof record!=='string')throw new AuthError('TRANSFER_HAS_NO_WORKSPACE');
  let parsed:Record<string,unknown>;try{parsed=JSON.parse(record);}catch{throw new AuthError('INVALID_WORKSPACE_DATA');}
  if(parsed.schemaVersion!==5||!arrays.every(key=>Array.isArray(parsed[key])))throw new AuthError('INVALID_WORKSPACE_DATA');
  return storage as Record<string,string>;
}
function recordKey(value:unknown){
  if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof (value as {id?:unknown}).id==='string')return `id:${(value as {id:string}).id}`;
  return `value:${stable(value)}`;
}
type ArrayMerge={items:unknown[];added:number;duplicates:number;conflicts:number;conflictingIds:Set<string>};
function mergeArray(existing:unknown[],incoming:unknown[],blockedAttachmentIds:Set<string>,field:string):ArrayMerge{
  const result=[...existing],byKey=new Map(existing.map((item)=>[recordKey(item),stable(item)]));let added=0,duplicates=0,conflicts=0;const conflictingIds=new Set<string>();
  for(const item of incoming){
    const object=item&&typeof item==='object'?item as Record<string,unknown>:{};
    if(field==='materials'&&typeof object.attachmentId==='string'&&blockedAttachmentIds.has(object.attachmentId)){conflicts++;continue;}
    const companyId=typeof object.companyId==='string'?object.companyId:typeof object.company_id==='string'?object.company_id:null;
    if(companyId&&blockedAttachmentIds.has(`company:${companyId}`)){conflicts++;continue;}
    const key=recordKey(item),value=stable(item),prior=byKey.get(key);
    if(prior===undefined){result.push(item);byKey.set(key,value);added++;}
    else if(prior===value)duplicates++;
    else {conflicts++;if(typeof object.id==='string')conflictingIds.add(object.id);}
  }
  return {items:result,added,duplicates,conflicts,conflictingIds};
}
function deepFill(existing:unknown,incoming:unknown):unknown{
  if(existing===undefined)return incoming;
  if(!existing||typeof existing!=='object'||Array.isArray(existing)||!incoming||typeof incoming!=='object'||Array.isArray(incoming))return existing;
  const result={...(incoming as Record<string,unknown>),...(existing as Record<string,unknown>)};
  for(const [key,value] of Object.entries(incoming as Record<string,unknown>))result[key]=deepFill((existing as Record<string,unknown>)[key],value);
  return result;
}
function mergeData(existingValue:string|undefined,incomingValue:string,blocked:Set<string>){
  const incoming=JSON.parse(incomingValue) as Record<string,unknown>;
  if(!existingValue)return {value:JSON.stringify(incoming),added:Object.fromEntries(arrays.map(key=>[key,(incoming[key] as unknown[]).length])),duplicates:0,conflicts:0};
  const existing=JSON.parse(existingValue) as Record<string,unknown>;
  const companyMerge=mergeArray(Array.isArray(existing.companies)?existing.companies:[],incoming.companies as unknown[],blocked,'companies');
  const blockedRefs=new Set(blocked);for(const id of companyMerge.conflictingIds)blockedRefs.add(`company:${id}`);
  const stats={added:companyMerge.added,duplicates:companyMerge.duplicates,conflicts:companyMerge.conflicts};
  const merged:{[key:string]:unknown}={...incoming,...existing,schemaVersion:5};
  merged.preferences=deepFill(existing.preferences,incoming.preferences);
  merged.companies=companyMerge.items;
  for(const key of arrays.slice(1)){
    const merge=mergeArray(Array.isArray(existing[key])?existing[key] as unknown[]:[],incoming[key] as unknown[],blockedRefs,key);
    merged[key]=merge.items;stats.added+=merge.added;stats.duplicates+=merge.duplicates;stats.conflicts+=merge.conflicts;
  }
  return {value:JSON.stringify(merged),...stats};
}
export function mergeWorkspace(current:Record<string,string>,incoming:Record<string,string>,blockedAttachmentIds=new Set<string>()){
  const result={...incoming,...current};const ignored=new Set(['career-flow-data-v4','career-flow-pre-v5-backup']);let added=0,duplicates=0,conflicts=0;
  for(const key of Object.keys(incoming)){
    if(ignored.has(key))continue;
    if(key==='career-flow-data-v5'){
      const merged=mergeData(current[key],incoming[key],blockedAttachmentIds);result[key]=merged.value;added+=Object.values(merged.added).reduce((sum,value)=>sum+value,0);duplicates+=merged.duplicates;conflicts+=merged.conflicts;
    }else if(key==='yami-product-update-read-ids'&&current[key]){
      try{const readIds=[...new Set([...JSON.parse(current[key]),...JSON.parse(incoming[key])])];result[key]=JSON.stringify(readIds);}catch{result[key]=current[key];conflicts++;}
    }else if(current[key]!==undefined)duplicates++;
    else {result[key]=incoming[key];added++;}
  }
  return {storage:result,added,duplicates,conflicts};
}
async function existingFile(db:D1,user:string,item:ManifestFile){
  const file=await db.prepare('SELECT content,media_type FROM user_files WHERE user_id=? AND kind=? AND id=?').bind(user,item.kind,item.id).first<{content:ArrayBuffer|number[];media_type:string}>();
  if(!file)return null;const bytes=Array.isArray(file.content)?new Uint8Array(file.content):new Uint8Array(file.content);return {sha256:await sha256(bytes),mediaType:file.media_type};
}
async function preview(db:D1,user:string,incoming:Record<string,string>,manifest:ManifestFile[]){
  const row=await db.prepare('SELECT revision,storage FROM user_workspaces WHERE user_id=?').bind(user).first<{revision:number;storage:string}>();
  if(!row)throw new AuthError('WORKSPACE_MISSING',503);
  const upload:ManifestFile[]=[],conflictingAttachmentIds=new Set<string>();let assetDuplicates=0,assetConflicts=0;
  for(const file of manifest){const existing=await existingFile(db,user,file);if(!existing)upload.push(file);else if(existing.sha256===file.sha256){assetDuplicates++;}else{assetConflicts++;if(file.kind==='attachments')conflictingAttachmentIds.add(file.id);}}
  const merged=mergeWorkspace(JSON.parse(row.storage),incoming,conflictingAttachmentIds);
  return {revision:row.revision,upload,counts:{newRecords:merged.added,duplicateRecords:merged.duplicates,recordConflicts:merged.conflicts,newFiles:upload.length,duplicateFiles:assetDuplicates,fileConflicts:assetConflicts},conflictingAttachmentIds:[...conflictingAttachmentIds]};
}
async function readJson(request:Request,limit=1_000_000){try{return JSON.parse(new TextDecoder().decode(await bodyBytes(request,limit)));}catch(error){if(error instanceof AuthError)throw error;throw new AuthError('INVALID_JSON',400);}}
function errorResponse(error:unknown){return json({error:error instanceof AuthError?error.code:'IMPORT_UNAVAILABLE'},error instanceof AuthError?error.status:503);}

export async function accountImportRequest(request:Request,db:D1,user:string){
  const url=new URL(request.url);if(url.origin!==LOCAL_ORIGIN)return json({error:'LOCAL_ACCOUNT_TEST_ONLY'},403);
  try{
    if(url.search)throw new AuthError('CLIENT_IDENTIFIERS_FORBIDDEN');
    if(request.method!=='GET'&&request.headers.get('origin')!==LOCAL_ORIGIN)throw new AuthError('ORIGIN_DENIED',403);
    if(url.pathname==='/api/migrations/preview'&&request.method==='POST'){
      const input=await readJson(request);const incoming=validateIncomingStorage(input.storage);const manifest=parseManifest(input.manifest);return json(await preview(db,user,incoming,manifest));
    }
    if(url.pathname==='/api/migrations/latest'&&request.method==='GET'){
      const item=await db.prepare("SELECT id,state,fingerprint,created_at,rolled_back_at FROM user_imports WHERE user_id=? AND state IN ('committed','rolled_back') ORDER BY created_at DESC LIMIT 1").bind(user).first();
      return json({latest:item??null});
    }
    if(url.pathname==='/api/migrations'&&request.method==='POST'){
      const input=await readJson(request);if(typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw new AuthError('INVALID_IMPORT');
      const incoming=validateIncomingStorage(input.storage),manifest=parseManifest(input.manifest);const current=await preview(db,user,incoming,manifest);
      if(current.revision!==input.expectedRevision)throw new AuthError('WORKSPACE_CONFLICT',409);
      const existing=await db.prepare("SELECT id,state FROM user_imports WHERE user_id=? AND fingerprint=? AND state='committed'").bind(user,input.fingerprint).first<{id:string;state:string}>();
      if(existing)throw new AuthError('IMPORT_ALREADY_APPLIED',409);
      const id=crypto.randomUUID();const now=new Date().toISOString();
      await db.prepare("INSERT INTO user_imports(id,user_id,fingerprint,state,expected_revision,manifest,source_storage,created_at) VALUES(?,?,?,'staging',?,?,?,?)").bind(id,user,input.fingerprint,input.expectedRevision,JSON.stringify({all:manifest,upload:current.upload}),JSON.stringify(incoming),now).run();
      return json({id,upload:current.upload});
    }
    const fileRoute=url.pathname.match(/^\/api\/migrations\/([0-9a-f-]{36})\/files\/(attachments|backups)\/([A-Za-z0-9_-]{1,120})$/);
    if(fileRoute&&request.method==='PUT'){
      const [,id,kind,fileId]=fileRoute;const run=await db.prepare("SELECT manifest FROM user_imports WHERE id=? AND user_id=? AND state='staging'").bind(id,user).first<{manifest:string}>();if(!run)throw new AuthError('IMPORT_NOT_FOUND',404);
      const manifest=parseManifest((JSON.parse(run.manifest) as {upload:unknown}).upload).find(item=>item.kind===kind&&item.id===fileId);if(!manifest)throw new AuthError('FILE_NOT_IN_IMPORT');
      const content=await bodyBytes(request,1_000_000);if(content.byteLength!==manifest.size||await sha256(content)!==manifest.sha256)throw new AuthError('IMPORT_FILE_CHECKSUM_MISMATCH',400);
      await db.prepare('INSERT INTO user_import_staged_files(user_id,import_id,kind,id,content,media_type,sha256) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,import_id,kind,id) DO UPDATE SET content=excluded.content,media_type=excluded.media_type,sha256=excluded.sha256').bind(user,id,kind,fileId,content.buffer,request.headers.get('content-type')?.split(';')[0]||'application/octet-stream',manifest.sha256).run();
      return json({staged:true});
    }
    const importRoute=url.pathname.match(/^\/api\/migrations\/([0-9a-f-]{36})(?:\/(commit|rollback|abort))?$/);
    if(importRoute){
      const [,id,action]=importRoute;
      if(action==='abort'&&request.method==='POST'){
        await db.batch([db.prepare("DELETE FROM user_import_staged_files WHERE user_id=? AND import_id=? AND EXISTS(SELECT 1 FROM user_imports WHERE id=? AND user_id=? AND state='staging')").bind(user,id,id,user),db.prepare("UPDATE user_imports SET state='aborted' WHERE user_id=? AND id=? AND state='staging'").bind(user,id)]);return json({aborted:true});
      }
      if(action==='commit'&&request.method==='POST')return await commit(db,user,id);
      if(action==='rollback'&&request.method==='POST')return await rollback(db,user,id);
    }
    throw new AuthError('NOT_FOUND',404);
  }catch(error){return errorResponse(error);}
}

async function commit(db:D1,user:string,id:string){
  const run=await db.prepare("SELECT fingerprint,expected_revision,manifest,source_storage FROM user_imports WHERE id=? AND user_id=? AND state='staging'").bind(id,user).first<{fingerprint:string;expected_revision:number;manifest:string;source_storage:string}>();if(!run)throw new AuthError('IMPORT_NOT_FOUND',404);
  const manifestRecord=JSON.parse(run.manifest) as {all:unknown;upload:unknown};const allManifest=parseManifest(manifestRecord.all),manifest=parseManifest(manifestRecord.upload);const staged=await db.prepare('SELECT kind,id,sha256 FROM user_import_staged_files WHERE user_id=? AND import_id=?').bind(user,id).all<{kind:Kind;id:string;sha256:string}>();
  if(staged.results.length!==manifest.length||manifest.some(file=>!staged.results.some(item=>item.kind===file.kind&&item.id===file.id&&item.sha256===file.sha256)))throw new AuthError('IMPORT_FILES_INCOMPLETE',409);
  const workspace=await db.prepare('SELECT revision,storage FROM user_workspaces WHERE user_id=?').bind(user).first<{revision:number;storage:string}>();if(!workspace||workspace.revision!==run.expected_revision)throw new AuthError('WORKSPACE_CONFLICT',409);
  const incoming=validateIncomingStorage(JSON.parse(run.source_storage));const current=JSON.parse(workspace.storage) as Record<string,string>;
  const conflictingAttachmentIds=new Set<string>();for(const file of allManifest){if(file.kind!=='attachments')continue;const old=await existingFile(db,user,file);if(old&&old.sha256!==file.sha256)conflictingAttachmentIds.add(file.id);}
  const merged=mergeWorkspace(current,incoming,conflictingAttachmentIds);const storage=JSON.stringify(merged.storage),next=run.expected_revision+1,now=new Date().toISOString();
  const results=await db.batch([
    db.prepare('INSERT INTO user_import_snapshot_files(user_id,import_id,kind,id,content,media_type,updated_at) SELECT user_id,?,kind,id,content,media_type,updated_at FROM user_files WHERE user_id=?').bind(id,user),
    db.prepare('UPDATE user_workspaces SET storage=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM user_imports WHERE id=? AND user_id=? AND state=\'staging\')').bind(storage,now,user,run.expected_revision,id,user),
    db.prepare('INSERT INTO user_files(user_id,kind,id,content,media_type,updated_at) SELECT staged.user_id,staged.kind,staged.id,staged.content,staged.media_type,? FROM user_import_staged_files staged WHERE staged.user_id=? AND staged.import_id=? AND EXISTS(SELECT 1 FROM user_workspaces WHERE user_id=? AND revision=? AND storage=?) AND NOT EXISTS(SELECT 1 FROM user_files prior WHERE prior.user_id=staged.user_id AND prior.kind=staged.kind AND prior.id=staged.id)').bind(now,user,id,user,next,storage),
    db.prepare("UPDATE user_imports SET state='committed',previous_revision=?,previous_storage=?,applied_revision=?,created_at=? WHERE id=? AND user_id=? AND state='staging' AND EXISTS(SELECT 1 FROM user_workspaces WHERE user_id=? AND revision=? AND storage=?)").bind(run.expected_revision,workspace.storage,next,now,id,user,user,next,storage),
    db.prepare('DELETE FROM user_import_staged_files WHERE user_id=? AND import_id=? AND EXISTS(SELECT 1 FROM user_imports WHERE id=? AND user_id=? AND state=\'committed\')').bind(user,id,id,user),
  ]);
  if(!results[1].meta.changes||!results[3].meta.changes){await db.prepare('DELETE FROM user_import_snapshot_files WHERE user_id=? AND import_id=? AND EXISTS(SELECT 1 FROM user_imports WHERE id=? AND state=\'staging\')').bind(user,id,id).run();throw new AuthError('WORKSPACE_CONFLICT',409);}
  const stats=await preview(db,user,incoming,manifest);return json({committed:true,id,revision:next,counts:stats.counts});
}
async function rollback(db:D1,user:string,id:string){
  const run=await db.prepare("SELECT previous_storage,state FROM user_imports WHERE id=? AND user_id=? AND state='committed'").bind(id,user).first<{previous_storage:string;state:string}>();if(!run)throw new AuthError('ROLLBACK_NOT_AVAILABLE',409);
  const current=await db.prepare('SELECT revision FROM user_workspaces WHERE user_id=?').bind(user).first<{revision:number}>();if(!current)throw new AuthError('WORKSPACE_MISSING',503);
  const next=current.revision+1,now=new Date().toISOString();
  const results=await db.batch([
    db.prepare('UPDATE user_workspaces SET storage=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM user_imports WHERE id=? AND user_id=? AND state=\'committed\')').bind(run.previous_storage,now,user,current.revision,id,user),
    db.prepare('DELETE FROM user_files WHERE user_id=? AND EXISTS(SELECT 1 FROM user_workspaces WHERE user_id=? AND revision=?) AND EXISTS(SELECT 1 FROM user_imports WHERE id=? AND user_id=? AND state=\'committed\')').bind(user,user,next,id,user),
    db.prepare('INSERT INTO user_files(user_id,kind,id,content,media_type,updated_at) SELECT user_id,kind,id,content,media_type,updated_at FROM user_import_snapshot_files WHERE user_id=? AND import_id=? AND EXISTS(SELECT 1 FROM user_workspaces WHERE user_id=? AND revision=?)').bind(user,id,user,next),
    db.prepare("UPDATE user_imports SET state='rolled_back',rolled_back_at=? WHERE id=? AND user_id=? AND state='committed' AND EXISTS(SELECT 1 FROM user_workspaces WHERE user_id=? AND revision=?)").bind(now,id,user,user,next),
  ]);
  if(!results[0].meta.changes||!results[3].meta.changes)throw new AuthError('WORKSPACE_CONFLICT',409);
  return json({rolledBack:true,revision:next});
}
