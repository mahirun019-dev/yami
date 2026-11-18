import {AuthError,LOCAL_ORIGIN} from './auth';
import {matchesCompanyIdentity} from '../../watch-service/src/monitor';
type DB=D1Database;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const sourceTypes=new Set(['mynavi','official','other']);
function normalizeSource(raw:string){
  let url:URL;try{url=new URL(raw);}catch{throw new AuthError('INVALID_WATCH_URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.hostname==='localhost'||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal'))throw new AuthError('INVALID_WATCH_URL');
  url.hostname=url.hostname.toLowerCase();url.port=url.port==='443'?'':url.port;url.pathname=url.pathname.replace(/\/{2,}/g,'/').replace(/\/$/,'')||'/';
  return {normalized:url.toString(),original:raw};
}
async function sourceKey(type:string,url:string){
  const bytes=new TextEncoder().encode(`${type}\n${url}`);const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return [...digest].map(value=>value.toString(16).padStart(2,'0')).join('');
}
async function body(request:Request){
  const reader=request.body?.getReader();if(!reader)return '{}';const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>20_000){await reader.cancel();throw new AuthError('REQUEST_TOO_LARGE',413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}try{return new TextDecoder().decode(bytes);}catch{throw new AuthError('INVALID_JSON',400);}
}
export async function personalWatchRequest(request:Request,db:DB,user:string){
  const url=new URL(request.url);try{
    if(url.origin!==LOCAL_ORIGIN)throw new AuthError('LOCAL_ACCOUNT_TEST_ONLY',403);
    if(url.search)throw new AuthError('CLIENT_IDENTIFIERS_FORBIDDEN');
    if(request.method!=='GET'&&request.headers.get('origin')!==LOCAL_ORIGIN)throw new AuthError('ORIGIN_DENIED',403);
    if(url.pathname==='/api/watch/targets'&&request.method==='GET'){
      const targets=await db.prepare(`SELECT s.id,s.company_id,s.company_name,x.source_type,s.label,x.url,s.enabled,s.created_at,t.company_name AS checked_company_name,CASE WHEN t.last_checked_at IS NULL THEN 'pending' ELSE 'checked' END AS runner_state,COALESCE(t.status,'paused') AS status,t.health_status,t.last_checked_at,t.last_error,t.entry_status,t.entry_url,t.detected_company_name FROM account_watch_subscriptions s JOIN account_watch_sources x ON x.source_key=s.source_key LEFT JOIN watch_targets t ON t.id=x.source_key WHERE s.user_id=? ORDER BY s.created_at DESC`).bind(user).all<Record<string,unknown>>();
      for(const target of targets.results)if(target.checked_company_name&&!matchesCompanyIdentity(String(target.company_name),String(target.checked_company_name))){target.health_status='identity_mismatch';target.entry_status='unknown';target.entry_url=null;target.status='error';}
      const events=await personalEvents(db,user);
      return json({targets:targets.results,events,runnerAvailable:true});
    }
    if(url.pathname==='/api/watch/targets'&&request.method==='POST'){
      let input:Record<string,unknown>;try{input=JSON.parse(await body(request)) as Record<string,unknown>;}catch(error){if(error instanceof AuthError)throw error;throw new AuthError('INVALID_JSON',400);}
      if(!input||typeof input.companyId!=='string'||!input.companyId||input.companyId.length>120||typeof input.companyName!=='string'||!input.companyName.trim()||input.companyName.length>240||typeof input.url!=='string'||input.url.length>2000||typeof input.sourceType!=='string'||!sourceTypes.has(input.sourceType)||Object.keys(input).some(key=>!['companyId','companyName','url','sourceType','label'].includes(key)))throw new AuthError('INVALID_WATCH_TARGET');
      const workspace=await db.prepare('SELECT storage FROM user_workspaces WHERE user_id=?').bind(user).first<{storage:string}>();
      const companies=JSON.parse(JSON.parse(workspace?.storage||'{}')['career-flow-data-v5']||'{"companies":[]}').companies;
      if(!Array.isArray(companies)||!companies.some((item:{id:string;name:string})=>item.id===input.companyId&&item.name===input.companyName))throw new AuthError('COMPANY_NOT_OWNED',403);
      const parsed=normalizeSource(input.url),key=await sourceKey(input.sourceType,parsed.normalized),id=crypto.randomUUID(),now=new Date().toISOString();
      const result=await db.batch([
        db.prepare("INSERT INTO account_watch_sources(source_key,source_type,normalized_url,url,created_at) VALUES(?,?,?,?,?) ON CONFLICT(source_type,normalized_url) DO NOTHING").bind(key,input.sourceType,parsed.normalized,parsed.original,now),
        db.prepare("INSERT INTO account_watch_subscriptions(id,user_id,company_id,company_name,source_key,label,enabled,created_at) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(user_id,company_id,source_key) DO NOTHING").bind(id,user,input.companyId,input.companyName.trim(),key,typeof input.label==='string'?input.label.slice(0,120):'',now),
      ]);
      const target=await db.prepare('SELECT s.id,s.company_id,s.company_name,x.source_type,s.label,x.url,s.enabled,s.created_at,x.runner_state FROM account_watch_subscriptions s JOIN account_watch_sources x ON x.source_key=s.source_key WHERE s.user_id=? AND s.company_id=? AND s.source_key=?').bind(user,input.companyId,key).first();
      return json({target,created:Boolean(result[1].meta.changes),runnerAvailable:false},result[1].meta.changes?201:200);
    }
    const targetMatch=url.pathname.match(/^\/api\/watch\/targets\/([A-Za-z0-9_-]{1,120})$/);
    if(targetMatch&&request.method==='DELETE'){
      const result=await db.prepare('DELETE FROM account_watch_subscriptions WHERE id=? AND user_id=?').bind(targetMatch[1],user).run();return result.meta.changes?json({deleted:true}):json({error:'NOT_FOUND'},404);
    }
    if(url.pathname==='/api/watch/run'&&request.method==='POST'){
      const {runAccountWatch}=await import('./watchRunner');
      return json(await runAccountWatch({AUTH_ENV:'local-google-test',ACCOUNT_DB:db}));
    }
    if(url.pathname==='/api/watch/events'&&request.method==='GET')return json({events:await personalEvents(db,user),runnerAvailable:true});
    if(url.pathname==='/api/watch/events/read-all'&&request.method==='POST'){
      const now=new Date().toISOString();await db.prepare('INSERT INTO account_watch_event_reads(user_id,event_id,read_at) SELECT DISTINCT ?,d.event_id,? FROM account_watch_event_deliveries d WHERE d.user_id=? ON CONFLICT(user_id,event_id) DO UPDATE SET read_at=excluded.read_at').bind(user,now,user).run();return json({read:true});
    }
    const readMatch=url.pathname.match(/^\/api\/watch\/events\/([A-Za-z0-9_-]{1,120})\/read$/);
    if(readMatch&&request.method==='POST'){
      const eventId=readMatch[1],now=new Date().toISOString();const result=await db.prepare('INSERT INTO account_watch_event_reads(user_id,event_id,read_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM account_watch_event_deliveries WHERE user_id=? AND event_id=?) ON CONFLICT(user_id,event_id) DO UPDATE SET read_at=excluded.read_at').bind(user,eventId,now,user,eventId).run();return result.meta.changes?json({read:true}):json({error:'NOT_FOUND'},404);
    }
    throw new AuthError('NOT_FOUND',404);
  }catch(error){return json({error:error instanceof AuthError?error.code:'WATCH_UNAVAILABLE'},error instanceof AuthError?error.status:503);}
}
async function personalEvents(db:DB,user:string){
  const result=await db.prepare(`SELECT e.id,s.company_id,s.company_name,s.id AS watch_target_id,e.event_type,e.title,e.summary,e.detected_at,e.source_url,x.source_type,CASE WHEN r.event_id IS NULL THEN 0 ELSE 1 END AS read FROM account_watch_event_deliveries d JOIN account_watch_subscriptions s ON s.id=d.subscription_id AND s.user_id=d.user_id JOIN account_watch_events e ON e.id=d.event_id JOIN account_watch_sources x ON x.source_key=e.source_key LEFT JOIN account_watch_event_reads r ON r.user_id=d.user_id AND r.event_id=e.id WHERE d.user_id=? ORDER BY e.detected_at DESC LIMIT 200`).bind(user).all();
  return result.results;
}

export async function publishPersonalWatchEvent(db:DB,event:{sourceKey:string;eventType:string;title:string;summary:string;sourceUrl:string;contentHash:string;detectedAt:string}){
  const id=crypto.randomUUID();
  const inserted=await db.prepare('INSERT INTO account_watch_events(id,source_key,event_type,title,summary,source_url,content_hash,detected_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_key,content_hash,event_type) DO NOTHING').bind(id,event.sourceKey,event.eventType,event.title,event.summary,event.sourceUrl,event.contentHash,event.detectedAt).run();
  const row=await db.prepare('SELECT id FROM account_watch_events WHERE source_key=? AND content_hash=? AND event_type=?').bind(event.sourceKey,event.contentHash,event.eventType).first<{id:string}>();if(!row)return {published:false};
  const source=await db.prepare('SELECT company_name FROM watch_targets WHERE id=?').bind(event.sourceKey).first<{company_name:string}>();
  const subscribers=await db.prepare('SELECT id,user_id,company_name,created_at FROM account_watch_subscriptions WHERE source_key=? AND enabled=1').bind(event.sourceKey).all<{id:string;user_id:string;company_name:string;created_at:string}>();
  let deliveries=0;
  for(const subscriber of subscribers.results){
    if(subscriber.created_at>event.detectedAt||!source||!matchesCompanyIdentity(source.company_name,subscriber.company_name))continue;
    const result=await db.prepare('INSERT OR IGNORE INTO account_watch_event_deliveries(user_id,subscription_id,event_id,created_at) VALUES(?,?,?,?)').bind(subscriber.user_id,subscriber.id,row.id,new Date().toISOString()).run();deliveries+=result.meta.changes;
  }
  return {published:Boolean(inserted.meta.changes),deliveries,eventId:row.id};
}
