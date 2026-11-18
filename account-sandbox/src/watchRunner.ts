import {scheduled as runExistingMonitor} from '../../watch-service/src/index';
import {publishPersonalWatchEvent} from './personalWatch';

// Only the account emulator is passed in. Never bind the production monitoring DB.
export async function runAccountWatch(env:{AUTH_ENV:string;ACCOUNT_DB:D1Database}, monitor=runExistingMonitor){
  if(env.AUTH_ENV!=='local-google-test')throw new Error('LOCAL_ACCOUNT_TEST_ONLY');
  const db=env.ACCOUNT_DB,id=crypto.randomUUID(),now=new Date().toISOString();
  const busy=await db.prepare("SELECT id FROM account_watch_runs WHERE outcome='running' AND started_at>?").bind(new Date(Date.now()-180_000).toISOString()).first();
  if(busy)return {busy:true};
  const claimed=await db.prepare("INSERT INTO account_watch_runs(id,started_at,outcome) SELECT ?,?,'running' WHERE NOT EXISTS(SELECT 1 FROM account_watch_runs WHERE outcome='running' AND started_at>?)").bind(id,now,new Date(Date.now()-180_000).toISOString()).run();
  if(!claimed.meta.changes)return {busy:true};
  let failure:unknown;
  try{
    await db.prepare(`INSERT OR IGNORE INTO watch_targets(id,company_id,company_name,source_type,url,normalized_url,created_at,updated_at,status)
      SELECT x.source_key,x.source_key,s.company_name,x.source_type,x.url,x.normalized_url,?,?, 'paused'
      FROM account_watch_sources x JOIN account_watch_subscriptions s ON s.source_key=x.source_key
      WHERE s.enabled=1 GROUP BY x.source_key`).bind(now,now).run();
    await db.prepare('UPDATE watch_targets SET enabled=CASE WHEN EXISTS(SELECT 1 FROM account_watch_subscriptions s WHERE s.source_key=watch_targets.id AND s.enabled=1) THEN 1 ELSE 0 END').run();
    await monitor({DB:db,WATCH_ACCESS_CODE:'',ALLOWED_ORIGIN:'http://127.0.0.1:8790'});
  }catch(error){failure=error;}
  // Drain persisted results even after a partial run; retries are idempotent.
  const events=await db.prepare('SELECT * FROM watch_events').all<{watch_target_id:string;event_type:string;title:string;summary:string;source_url:string;content_hash:string;detected_at:string}>();
  for(const event of events.results)await publishPersonalWatchEvent(db,{sourceKey:event.watch_target_id,eventType:event.event_type,title:event.title,summary:event.summary,sourceUrl:event.source_url,contentHash:event.content_hash,detectedAt:event.detected_at});
  await db.prepare('UPDATE account_watch_runs SET finished_at=?,outcome=? WHERE id=?').bind(new Date().toISOString(),failure?'failed':'success',id).run();
  if(failure)throw new Error('ACCOUNT_WATCH_RUN_INCOMPLETE');
  return {id,busy:false};
}

