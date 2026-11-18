import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {runAccountWatch} from '../src/watchRunner';

const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("acceptance")}}',compatibilityDate:'2026-10-30',d1Databases:{DB:'disposable-live-acceptance'}}));
const db=await mf.getD1Database('DB') as unknown as D1Database;
const report:{mode:string;rounds:unknown[];error?:string}={mode:'real upstream; disposable DB; automatic short acceptance timers, NOT natural six-hour Cron',rounds:[]};
try{
 for(const name of ['0001_local_accounts','0002_user_workspace','0003_user_imports','0004_personal_watch','0005_watch_runner']){const sql=readFileSync(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8');await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));}
 const sources=[{id:'acceptance-hrmos',name:'株式会社Aiming',type:'official',url:'https://hrmos.co/pages/aiming/jobs/2210232845074915332'},{id:'acceptance-mynavi',name:'(株)レコモット',type:'mynavi',url:'https://job.mynavi.jp/28/pc/search/corp292189/outline.html'}];
 const now=new Date().toISOString();
 for(const user of ['acceptance-A','acceptance-B'])await db.prepare('INSERT INTO users(id,issuer,subject,verified_email,created_at,last_login_at) VALUES(?,?,?,?,?,?)').bind(user,'https://accounts.google.com',user,`${user}@example.test`,Date.now(),Date.now()).run();
 for(const source of sources){await db.prepare('INSERT INTO account_watch_sources(source_key,source_type,normalized_url,url,created_at) VALUES(?,?,?,?,?)').bind(source.id,source.type,source.url,source.url,now).run();for(const user of ['acceptance-A','acceptance-B'])await db.prepare('INSERT INTO account_watch_subscriptions(id,user_id,company_id,company_name,source_key,enabled,created_at) VALUES(?,?,?,?,?,1,?)').bind(`${user}-${source.id}`,user,source.id,source.name,source.id,now).run();}
 for(let round=1;round<=2;round++){
  // Timers drive the acceptance run; never invoke production /__scheduled.
  await new Promise<void>(resolve=>setTimeout(resolve,round===1?1000:15000));
  const startedAt=new Date().toISOString();let error:string|null=null;
  try{await runAccountWatch({AUTH_ENV:'local-google-test',ACCOUNT_DB:db});}catch(e){error=e instanceof Error?e.message:'RUN_FAILED';}
  const rows=await db.prepare('SELECT company_name,url,status,health_status,health_detail,last_http_status,last_checked_at,last_success_at,detected_company_name,entry_status,entry_url,length(snapshot) AS snapshot_length,last_hash FROM watch_targets ORDER BY id').all();
  const counts=await db.prepare('SELECT (SELECT COUNT(*) FROM watch_events) AS events,(SELECT COUNT(*) FROM account_watch_event_deliveries) AS deliveries').first();
  const result={round,startedAt,finishedAt:new Date().toISOString(),error,sources:rows.results,counts};report.rounds.push(result);console.log(JSON.stringify({acceptanceRound:result}));
 }
}catch(e){report.error=e instanceof Error?e.message:'ACCEPTANCE_FAILED';process.exitCode=1;}
finally{mkdirSync(new URL('../.wrangler/',import.meta.url),{recursive:true});writeFileSync(new URL('../.wrangler/live-watch-acceptance.json',import.meta.url),JSON.stringify(report,null,2));await mf.dispose();}
