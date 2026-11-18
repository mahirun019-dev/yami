import { AuthError, cookie, currentSession, LOCAL_ORIGIN, SESSION_COOKIE } from './auth';
import { accountImportRequest } from './imports';
import { personalWatchRequest } from './personalWatch';

export const WORKSPACE_KEYS = new Set(['career-flow-data-v5','career-flow-demo-cleaned-v1','careerflow-theme','careerflow-last-manual-theme','careerflow-locale','careerflow-custom-icon','yami-last-main-view','careerflow-home-region','careerflow-company-stage-filter','careerflow-company-sort','careerflow-last-export','yami-product-update-read-ids']);
const headers = { 'content-type':'application/json', 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer' };
const json = (data: unknown, status=200) => new Response(JSON.stringify(data),{status,headers});
async function boundedBody(request:Request){
  if(Number(request.headers.get('content-length')??0)>1_000_000)throw new AuthError('LOCAL_TEST_BODY_LIMIT',413);
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1_000_000){await reader.cancel();throw new AuthError('LOCAL_TEST_BODY_LIMIT',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export async function workspaceRequest(request: Request, env: { AUTH_ENV: string; ACCOUNT_DB: D1Database }) {
  const url = new URL(request.url);
  try {
    if (env.AUTH_ENV !== 'local-google-test' || url.origin !== LOCAL_ORIGIN) throw new AuthError('LOCAL_ACCOUNT_TEST_ONLY',403);
    const session = await currentSession(env.ACCOUNT_DB,cookie(request,SESSION_COOKIE));
    if (!session) throw new AuthError('LOGIN_REQUIRED',401);
    // An asserted identity never authenticates a request; it prevents stale A tabs writing B's data.
    if (request.headers.get('x-yami-user') !== session.userId) throw new AuthError('ACCOUNT_CHANGED',409);
    if (url.search) throw new AuthError('CLIENT_OWNER_FORBIDDEN');
    if (request.method !== 'GET' && request.headers.get('origin') !== LOCAL_ORIGIN) throw new AuthError('ORIGIN_DENIED',403);
    const db=env.ACCOUNT_DB, owner=session.userId;
    if(url.pathname==='/api/migrations'||url.pathname.startsWith('/api/migrations/'))return accountImportRequest(request,db,owner);
    if(url.pathname==='/api/watch/run'||url.pathname==='/api/watch/targets'||url.pathname.startsWith('/api/watch/targets/')||url.pathname==='/api/watch/events'||url.pathname.startsWith('/api/watch/events/'))return personalWatchRequest(request,db,owner);
    if (url.pathname === '/api/workspace') {
      await db.prepare('INSERT INTO user_workspaces(user_id,updated_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING').bind(owner,new Date().toISOString()).run();
      if (request.method==='GET') {
        const row=await db.prepare('SELECT revision,storage FROM user_workspaces WHERE user_id=?').bind(owner).first<{revision:number;storage:string}>();
        return json({revision:row!.revision,storage:JSON.parse(row!.storage)});
      }
      if (request.method==='PUT') {
        const raw=new TextDecoder().decode(await boundedBody(request));
        const body=JSON.parse(raw);
        if (!body || Object.keys(body).sort().join(',')!=='revision,storage' || !Number.isSafeInteger(body.revision) || body.revision<0 || !body.storage || typeof body.storage!=='object' || Array.isArray(body.storage)) throw new AuthError('INVALID_WORKSPACE');
        for (const [key,value] of Object.entries(body.storage)) if (!WORKSPACE_KEYS.has(key) || typeof value!=='string') throw new AuthError('INVALID_STORAGE_KEY');
        if(body.storage['career-flow-data-v5']){
          const data=JSON.parse(body.storage['career-flow-data-v5']);
          if(!data||data.schemaVersion!==5||!['companies','events','materials','interviews','preparations','templates'].every(key=>Array.isArray(data[key])))throw new AuthError('INVALID_WORKSPACE_DATA');
        }
        const result=await db.prepare('UPDATE user_workspaces SET storage=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?').bind(JSON.stringify(body.storage),new Date().toISOString(),owner,body.revision).run();
        if (!result.meta.changes) throw new AuthError('WORKSPACE_CONFLICT',409);
        return json({revision:body.revision+1});
      }
    }
    const path=url.pathname.match(/^\/api\/files\/(attachments|backups)(?:\/([A-Za-z0-9_-]{1,120}))?$/);
    if (path) {
      const [,kind,id]=path;
      if (!id && request.method==='GET') {
        const files=await db.prepare('SELECT id,media_type,updated_at FROM user_files WHERE user_id=? AND kind=? ORDER BY updated_at DESC').bind(owner,kind).all();
        return json({files:files.results});
      }
      if (!id) throw new AuthError('FILE_ID_REQUIRED');
      if (request.method==='GET') {
        const file=await db.prepare('SELECT content,media_type FROM user_files WHERE user_id=? AND kind=? AND id=?').bind(owner,kind,id).first<{content:ArrayBuffer|number[];media_type:string}>();
        if (!file) throw new AuthError('NOT_FOUND',404);
        return new Response(Array.isArray(file.content)?new Uint8Array(file.content):file.content,{headers:{...headers,'content-type':file.media_type,'content-disposition':'attachment'}});
      }
      if (request.method==='PUT') {
        const content=await boundedBody(request);
        const media=kind==='backups'?'application/json':request.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
        await db.prepare('INSERT INTO user_files(user_id,kind,id,content,media_type,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,kind,id) DO UPDATE SET content=excluded.content,media_type=excluded.media_type,updated_at=excluded.updated_at').bind(owner,kind,id,content.buffer,media,new Date().toISOString()).run();
        if(kind==='backups') await db.prepare("DELETE FROM user_files WHERE user_id=? AND kind='backups' AND id NOT IN (SELECT id FROM user_files WHERE user_id=? AND kind='backups' ORDER BY updated_at DESC LIMIT 5) AND NOT EXISTS(SELECT 1 FROM user_imports i,json_each(i.manifest,'$.all') f WHERE i.user_id=user_files.user_id AND i.state='committed' AND json_extract(f.value,'$.kind')='backups' AND json_extract(f.value,'$.id')=user_files.id)").bind(owner,owner).run();
        return json({saved:true});
      }
      if(request.method==='DELETE') {
        await db.prepare('DELETE FROM user_files WHERE user_id=? AND kind=? AND id=?').bind(owner,kind,id).run();
        return json({deleted:true});
      }
    }
    throw new AuthError('NOT_FOUND',404);
  }catch(error){return json({error:error instanceof AuthError?error.code:error instanceof SyntaxError?'INVALID_JSON':'WORKSPACE_UNAVAILABLE'},error instanceof AuthError?error.status:error instanceof SyntaxError?400:503);}
}
