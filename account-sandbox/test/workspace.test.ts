import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {establishSession,hash,GOOGLE_ISSUER,LOCAL_ORIGIN,SESSION_COOKIE} from '../src/auth.ts';
import {workspaceRequest} from '../src/workspace.ts';
import {publishPersonalWatchEvent} from '../src/personalWatch.ts';
import {createHandler} from '../src/index.ts';
import {runAccountWatch} from '../src/watchRunner.ts';
let mf:Miniflare,db:D1Database,a:Awaited<ReturnType<typeof establishSession>>,b:typeof a;
before(async()=>{mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-10-30',d1Databases:{DB:'workspace-isolation-tests'}}));db=await mf.getD1Database('DB') as unknown as D1Database;for(const file of ['0001_local_accounts.sql','0002_user_workspace.sql','0003_user_imports.sql','0004_personal_watch.sql','0005_watch_runner.sql']){const sql=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8');await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));}});
beforeEach(async()=>{await db.batch(['DELETE FROM watch_events','DELETE FROM watch_targets','DELETE FROM account_watch_runs','DELETE FROM account_watch_event_reads','DELETE FROM account_watch_event_deliveries','DELETE FROM account_watch_subscriptions','DELETE FROM account_watch_events','DELETE FROM account_watch_sources','DELETE FROM user_import_staged_files','DELETE FROM user_import_snapshot_files','DELETE FROM user_imports','DELETE FROM user_files','DELETE FROM user_workspaces','DELETE FROM sessions','DELETE FROM login_transactions','DELETE FROM users'].map(s=>db.prepare(s)));a=await establishSession(db,{issuer:GOOGLE_ISSUER,subject:'user-A',email:'a@example.test',emailVerified:true},null);b=await establishSession(db,{issuer:GOOGLE_ISSUER,subject:'user-B',email:'b@example.test',emailVerified:true},null);});
after(async()=>{await mf?.dispose();});
async function call(path='/api/workspace',user=a,method='GET',body?:string,owner=user.userId,origin=LOCAL_ORIGIN){return workspaceRequest(new Request(LOCAL_ORIGIN+path,{method,headers:{cookie:`${SESSION_COOKIE}=${user.raw}`,'x-yami-user':owner,origin,'content-type':'application/json'},...(body!==undefined?{body}:{})}),{AUTH_ENV:'local-google-test',ACCOUNT_DB:db});}
async function routedCall(path:string,user=a){const handler=createHandler(async()=>{throw new Error('OIDC_NOT_EXPECTED');});return handler(new Request(LOCAL_ORIGIN+path,{headers:{cookie:`${SESSION_COOKIE}=${user.raw}`,'x-yami-user':user.userId}}),{AUTH_ENV:'local-google-test',ACCOUNT_DB:db} as never);}
const snapshot=(storage:Record<string,string>,revision=0)=>JSON.stringify({revision,storage});
test('new account is empty and never imports anonymous/shared data',async()=>{const data=await(await call()).json() as any;assert.deepEqual(data,{revision:0,storage:{'career-flow-demo-cleaned-v1':'1'}});});
test('all company/schedule/ES/settings/read-state values are isolated between A and B',async()=>{
  await call();const record=JSON.stringify({schemaVersion:5,companies:[{id:'A-company'}],events:[{id:'A-event'}],materials:[{id:'A-es'}],interviews:[{id:'A-interview'}],preparations:[{id:'A-prep'}],templates:[{id:'A-template'}],preferences:{fontSize:'xl'}});
  assert.equal((await call('/api/workspace',a,'PUT',snapshot({'career-flow-data-v5':record,'careerflow-theme':'dark','yami-product-update-read-ids':'["A-read"]'}))).status,200);
  const own=await(await call()).json() as any,other=await(await call('/api/workspace',b)).json() as any;
  assert.equal(own.storage['career-flow-data-v5'],record);assert.ok(!JSON.stringify(other).includes('A-company'));assert.ok(!other.storage['careerflow-theme']);
});
test('forged owner header never authenticates or lets stale A writes mutate B',async()=>{assert.equal((await call('/api/workspace',b,'PUT',snapshot({'careerflow-theme':'dark'}),a.userId)).status,409);assert.equal((await call('/api/workspace',b,'GET',undefined,a.userId)).status,409);});
test('client user IDs/query owners and privilege/token storage keys are rejected',async()=>{await call();assert.equal((await call('/api/workspace?userId='+b.userId)).status,400);for(const key of ['isPro','careerflow-watch-session','career-flow-data-v4','__proto__']){assert.equal((await call('/api/workspace',a,'PUT',snapshot(Object.fromEntries([[key,'x']])))).status,400);}assert.equal((await call('/api/workspace',a,'PUT',JSON.stringify({revision:0,storage:{},userId:b.userId}))).status,400);});
test('optimistic revisions refuse silent overwrites',async()=>{await call();assert.equal((await call('/api/workspace',a,'PUT',snapshot({'careerflow-theme':'dark'}))).status,200);assert.equal((await call('/api/workspace',a,'PUT',snapshot({'careerflow-theme':'light'}))).status,409);assert.equal((await(await call()).json() as any).storage['careerflow-theme'],'dark');});
test('same Google subject restores own workspace after session rotation',async()=>{await call();await call('/api/workspace',a,'PUT',snapshot({'careerflow-locale':'zh'}));const again=await establishSession(db,{issuer:GOOGLE_ISSUER,subject:'user-A',email:'new@example.test',emailVerified:true},a.raw);assert.equal(again.userId,a.userId);assert.equal((await(await call('/api/workspace',again)).json() as any).storage['careerflow-locale'],'zh');assert.equal((await call()).status,401);});
test('CSRF, revoked cookies and non-local environment fail closed',async()=>{await call();assert.equal((await call('/api/workspace',a,'PUT',snapshot({}),a.userId,'https://evil.example')).status,403);await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(a.raw)).run();assert.equal((await call()).status,401);assert.equal((await workspaceRequest(new Request('https://example.com/api/workspace'),{AUTH_ENV:'production',ACCOUNT_DB:db})).status,403);});
test('attachments cannot be read, listed, overwritten or deleted by another owner',async()=>{
  assert.equal((await call('/api/files/attachments/same-id',a,'PUT','A-private-file')).status,200);
  assert.equal((await call('/api/files/attachments/same-id',b)).status,404);
  assert.deepEqual((await(await call('/api/files/attachments',b)).json() as any).files,[]);
  await call('/api/files/attachments/same-id',b,'PUT','B-private-file');await call('/api/files/attachments/same-id',b,'DELETE');
  assert.equal(await(await call('/api/files/attachments/same-id',a)).text(),'A-private-file');
});
test('backup retention and deletion are owner-scoped',async()=>{await call('/api/files/backups/1',b,'PUT','{"owner":"B"}');for(let n=0;n<7;n++)await call('/api/files/backups/'+n,a,'PUT',JSON.stringify({n}));assert.equal(((await(await call('/api/files/backups',a)).json() as any).files).length,5);assert.equal(await(await call('/api/files/backups/1',b)).text(),'{"owner":"B"}');await call('/api/files/backups/1',a,'DELETE');assert.equal((await call('/api/files/backups/1',b)).status,200);});
test('anonymous requests cannot inspect any workspace or files',async()=>{for(const path of ['/api/workspace','/api/files/attachments','/api/files/backups/1'])assert.equal((await workspaceRequest(new Request(LOCAL_ORIGIN+path),{AUTH_ENV:'local-google-test',ACCOUNT_DB:db})).status,401);});
test('oversized local snapshots and files are rejected without changing existing data',async()=>{await call();assert.equal((await call('/api/workspace',a,'PUT','x'.repeat(1_000_001))).status,413);assert.equal((await call('/api/files/attachments/large',a,'PUT','x'.repeat(1_000_001))).status,413);assert.equal((await(await call()).json() as any).revision,0);});
test('malformed v5 content cannot overwrite the last valid account document',async()=>{await call();for(const value of ['broken-json','{"schemaVersion":5,"companies":null}'])assert.equal((await call('/api/workspace',a,'PUT',snapshot({'career-flow-data-v5':value}))).status,400);assert.equal((await(await call()).json() as any).revision,0);});

const digest=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(part=>part.toString(16).padStart(2,'0')).join('');
test('confirmed legacy import merges records, snapshots the full account, isolates owners, deduplicates and rolls back',async()=>{
  const original=JSON.stringify({schemaVersion:5,companies:[{id:'same-company',name:'Existing'}],events:[],materials:[],interviews:[],preparations:[],templates:[]});
  await call();await call('/api/workspace',a,'PUT',snapshot({'career-flow-data-v5':original,'careerflow-theme':'light'}));
  await call('/api/files/attachments/kept-file',a,'PUT','old attachment');await call('/api/files/backups/old-backup',a,'PUT','old backup');
  const bData=JSON.stringify({schemaVersion:5,companies:[{id:'B-only'}],events:[],materials:[],interviews:[],preparations:[],templates:[]});await call('/api/workspace',b,'PUT',snapshot({'career-flow-data-v5':bData}));
  const attachment=new TextEncoder().encode('migrated attachment'),attachmentHash=await digest('migrated attachment'),backupText=JSON.stringify({schemaVersion:5,createdAt:7,companies:[],schedules:[],resources:[],interviews:[],preparations:[],selectionRecords:[],settings:{}}),backupHash=await digest(backupText);
  const incoming=JSON.stringify({schemaVersion:5,companies:[{id:'same-company',name:'Different identity'},{id:'new-company',name:'Imported'}],events:[{id:'event-1',companyId:'new-company'}],materials:[{id:'material-1',companyId:'new-company',attachmentId:'new-file'}],interviews:[{id:'interview-1'}],preparations:[{id:'prep-1'}],templates:[{id:'template-1'}]});
  const manifest=[{kind:'attachments',id:'new-file',size:attachment.length,sha256:attachmentHash},{kind:'backups',id:'old-export',size:backupText.length,sha256:backupHash}];
  const preview=await(await call('/api/migrations/preview',a,'POST',JSON.stringify({storage:{'career-flow-data-v5':incoming,'careerflow-theme':'dark'},manifest}))).json() as any;
  assert.equal(preview.revision,1);assert.equal(preview.upload.length,2);assert.ok(preview.counts.recordConflicts>=1);
  const fingerprint=await digest('fixture-import-fingerprint');
  const started=await(await call('/api/migrations',a,'POST',JSON.stringify({fingerprint,expectedRevision:preview.revision,manifest,storage:{'career-flow-data-v5':incoming,'careerflow-theme':'dark'}}))).json() as any;
  assert.equal((await call(`/api/migrations/${started.id}/files/attachments/new-file`,b,'PUT','migrated attachment')).status,404);
  assert.equal((await call(`/api/migrations/${started.id}/files/attachments/new-file`,a,'PUT','migrated attachment')).status,200);
  assert.equal((await call(`/api/migrations/${started.id}/files/backups/old-export`,a,'PUT',backupText)).status,200);
  const commit=await call(`/api/migrations/${started.id}/commit`,a,'POST','{}');assert.equal(commit.status,200);
  const after=await(await call('/api/workspace',a)).json() as any;const merged=JSON.parse(after.storage['career-flow-data-v5']);
  assert.equal(merged.companies.find((item:any)=>item.id==='same-company').name,'Existing');assert.ok(merged.companies.some((item:any)=>item.id==='new-company'));assert.equal(merged.events.length,1);assert.equal(merged.materials.length,1);assert.equal(after.storage['careerflow-theme'],'light');
  assert.equal(await(await call('/api/files/attachments/new-file',a)).text(),'migrated attachment');assert.equal((await call('/api/files/attachments/new-file',b)).status,404);
  assert.equal((await call('/api/files/backups/old-export',a)).status,200);assert.equal((await call('/api/migrations',a,'POST',JSON.stringify({fingerprint,expectedRevision:preview.revision,manifest,storage:{'career-flow-data-v5':incoming}}))).status,409);
  assert.equal(((await(await call(`/api/migrations/latest`,a)).json() as any).latest).state,'committed');
  for(let n=0;n<7;n++)await call('/api/files/backups/'+(100+n),a,'PUT',JSON.stringify({createdAt:100+n}));
  assert.equal((await call('/api/files/backups/old-export',a)).status,200,'automatic retention must preserve imported backup archives');
  assert.equal((await call(`/api/migrations/${started.id}/rollback`,a,'POST','{}')).status,200);
  const restored=await(await call('/api/workspace',a)).json() as any;assert.equal(restored.storage['career-flow-data-v5'],original);assert.equal(restored.storage['careerflow-theme'],'light');
  assert.equal(await(await call('/api/files/attachments/kept-file',a)).text(),'old attachment');assert.equal(await(await call('/api/files/backups/old-backup',a)).text(),'old backup');assert.equal((await call('/api/files/attachments/new-file',a)).status,404);assert.equal((await call('/api/files/backups/old-export',a)).status,404);
  assert.equal((JSON.parse((await(await call('/api/workspace',b)).json() as any).storage['career-flow-data-v5'])).companies[0].id,'B-only');
});
test('stale workspace revision and bad file checksum do not apply an import',async()=>{
  await call();const content='asset',hash=await digest(content),manifest=[{kind:'attachments',id:'staged',size:content.length,sha256:hash}],storage={'career-flow-data-v5':JSON.stringify({schemaVersion:5,companies:[],events:[],materials:[],interviews:[],preparations:[],templates:[]})};
  const preview=await(await call('/api/migrations/preview',a,'POST',JSON.stringify({storage,manifest}))).json() as any;const started=await(await call('/api/migrations',a,'POST',JSON.stringify({fingerprint:await digest('stale-import'),expectedRevision:preview.revision,manifest,storage}))).json() as any;
  assert.equal((await call(`/api/migrations/${started.id}/files/attachments/staged`,a,'PUT','wrong')).status,400);
  await call('/api/workspace',a,'PUT',snapshot({'careerflow-theme':'dark'}));assert.equal((await call(`/api/migrations/${started.id}/commit`,a,'POST','{}')).status,409);assert.equal((await(await call('/api/workspace',a)).json() as any).storage['careerflow-theme'],'dark');
});
test('personal watch subscriptions reuse one canonical source while events and read receipts remain account-scoped',async()=>{
  for(const user of [a,b]){await call('/api/workspace',user);await call('/api/workspace',user,'PUT',snapshot({'career-flow-data-v5':JSON.stringify({schemaVersion:5,companies:[{id:user===a?'company-A':'company-B',name:'株式会社Aiming'}],events:[],materials:[],interviews:[],preparations:[],templates:[]})}));}
  const source={companyId:'company-A',companyName:'株式会社Aiming',sourceType:'mynavi',url:'https://example.com/recruit/'};
  const aCreated=await call('/api/watch/targets',a,'POST',JSON.stringify(source));assert.equal(aCreated.status,201);
  const bCreated=await call('/api/watch/targets',b,'POST',JSON.stringify({...source,companyId:'company-B'}));assert.equal(bCreated.status,201);
  await runAccountWatch({AUTH_ENV:'local-google-test',ACCOUNT_DB:db},async()=>{});
  await db.prepare("UPDATE account_watch_subscriptions SET created_at='2026-01-01'").run();
  const count=await db.prepare('SELECT COUNT(*) AS count FROM account_watch_sources').first<{count:number}>();assert.equal(count?.count,1);
  assert.equal((await call('/api/watch/targets',a,'POST',JSON.stringify({...source,userId:b.userId}))).status,400);
  const sourceRow=await db.prepare('SELECT source_key FROM account_watch_sources').first<{source_key:string}>();assert.ok(sourceRow);
  const published=await publishPersonalWatchEvent(db,{sourceKey:sourceRow!.source_key,eventType:'recruitment_update',title:'更新',summary:'職種情報',sourceUrl:source.url,contentHash:'change-1',detectedAt:'2026-10-30T00:00:00.000Z'});assert.equal(published.deliveries,2);
  const repeated=await publishPersonalWatchEvent(db,{sourceKey:sourceRow!.source_key,eventType:'recruitment_update',title:'更新',summary:'職種情報',sourceUrl:source.url,contentHash:'change-1',detectedAt:'2026-10-30T00:00:00.000Z'});assert.equal(repeated.published,false);
  const aEvents=await(await call('/api/watch/events',a)).json() as any,bEvents=await(await call('/api/watch/events',b)).json() as any;assert.equal(aEvents.events[0].read,0);assert.equal(bEvents.events[0].read,0);
  const eventId=aEvents.events[0].id;assert.equal((await call(`/api/watch/events/${eventId}/read`,a,'POST','{}')).status,200);
  const afterA=await(await call('/api/watch/events',a)).json() as any,stillB=await(await call('/api/watch/events',b)).json() as any;assert.equal(afterA.events[0].read,1);assert.equal(stillB.events[0].read,0);
  assert.equal((await call(`/api/watch/events/${eventId}/read`,b,'POST','{}',a.userId)).status,409);
  const targetA=(await(await call('/api/watch/targets',a)).json() as any).targets[0];assert.equal(targetA.runner_state,'pending');assert.equal(targetA.entry_status,null);
  assert.equal((await call(`/api/watch/targets/${targetA.id}`,a,'DELETE')).status,200);
  assert.equal(((await(await call('/api/watch/targets',a)).json()) as any).targets.length,0);
  assert.equal((await(await call('/api/watch/targets',b)).json() as any).targets.length,1);
});
test('real monitor engine fetches once per shared source, initializes silently and delivers a real change once',async()=>{
  for(const user of [a,b]){await call('/api/workspace',user);await call('/api/workspace',user,'PUT',snapshot({'career-flow-data-v5':JSON.stringify({schemaVersion:5,companies:[{id:'own-company',name:'株式会社Aiming'}],events:[],materials:[],interviews:[],preparations:[],templates:[]})}));await call('/api/watch/targets',user,'POST',JSON.stringify({companyId:'own-company',companyName:'株式会社Aiming',sourceType:'official',url:'https://example.com/recruit/'}));}
  const original=globalThis.fetch;let days=124,requests=0;
  globalThis.fetch=(async(input)=>{const url=String(input);if(url.includes('dns-query'))return Response.json({Answer:[{data:'198.51.100.10'}]});if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');requests++;return new Response(`<main><h1>株式会社Aiming</h1><section><h2>募集要項</h2><p>年間休日${days}日</p><p>募集職種はシステムエンジニアです。</p><p>応募資格、勤務地、初任給、福利厚生を掲載しています。</p></section></main>`,{headers:{'content-type':'text/html'}});}) as typeof fetch;
  try{await runAccountWatch({AUTH_ENV:'local-google-test',ACCOUNT_DB:db});assert.equal(requests,1);assert.equal((await(await call('/api/watch/events')).json() as any).events.length,0);days=130;await runAccountWatch({AUTH_ENV:'local-google-test',ACCOUNT_DB:db});for(const user of [a,b])assert.equal((await(await call('/api/watch/events',user)).json() as any).events.length,1);await runAccountWatch({AUTH_ENV:'local-google-test',ACCOUNT_DB:db});assert.equal((await(await call('/api/watch/events')).json() as any).events.length,1);assert.equal((await(await call('/api/watch/targets')).json() as any).targets[0].health_status,'healthy');}
  finally{globalThis.fetch=original;}
  assert.equal((await call('/api/watch/targets',b,'POST',JSON.stringify({companyId:'stolen',companyName:'株式会社Aiming',sourceType:'official',url:'https://example.com/other'}))).status,403);
});
test('top-level Worker routes account migration and personal-watch APIs through session validation',async()=>{
  await call();
  const migrations=await routedCall('/api/migrations/latest');assert.equal(migrations.status,200);assert.deepEqual((await migrations.json() as any).latest,null);
  const watch=await routedCall('/api/watch/targets');assert.equal(watch.status,200);assert.deepEqual((await watch.json() as any).targets,[]);
  const anonymousHandler=createHandler(async()=>{throw new Error('OIDC_NOT_EXPECTED');});
  const anonymous=await anonymousHandler(new Request(LOCAL_ORIGIN+'/api/migrations/latest'),{AUTH_ENV:'local-google-test',ACCOUNT_DB:db} as never);assert.equal(anonymous.status,401);
});
test('revoked login cannot access personal watch, migration or account files',async()=>{
  await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(a.raw)).run();
  for(const path of ['/api/workspace','/api/watch/targets','/api/watch/events','/api/migrations/latest','/api/files/attachments','/api/files/backups'])assert.equal((await call(path)).status,401);
  assert.equal((await call('/api/watch/run',a,'POST','{}')).status,401);
});
