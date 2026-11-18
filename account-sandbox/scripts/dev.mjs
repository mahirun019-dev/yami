import { mkdirSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') throw new Error('This local-only launcher requires a macOS/Linux null log sink.');
const root = new URL('../', import.meta.url);
const log = fileURLToPath(new URL('.wrangler/debug-null.log', root));
mkdirSync(new URL('.wrangler/', root), { recursive: true });
try {
  if (!lstatSync(log).isSymbolicLink() || readlinkSync(log) !== '/dev/null') throw new Error('Unexpected log target; refusing to write OAuth request logs.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  symlinkSync('/dev/null', log);
}
console.log('Local Google account test: http://127.0.0.1:8790 (request/debug logs disabled)');
const child = spawn(process.execPath, [fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', root)), 'dev', '--local', '--test-scheduled', '--ip', '127.0.0.1', '--port', '8790', '--log-level', 'error'], {
  cwd: fileURLToPath(root), stdio: 'inherit', env: { ...process.env, WRANGLER_LOG_PATH: log, WRANGLER_SEND_METRICS: 'false' },
});
let timer;
function scheduleLocalCheck(){
  const now=Date.now(),next=new Date(now);next.setUTCMinutes(17,0,0);next.setUTCHours(Math.floor(next.getUTCHours()/6)*6);if(next.getTime()<=now)next.setUTCHours(next.getUTCHours()+6);
  console.log(`Local-only watch schedule: ${next.toISOString()}`);
  timer=setTimeout(async()=>{try{const response=await fetch('http://127.0.0.1:8790/__scheduled?cron=17%20*%2F6%20*%20*%20*',{signal:AbortSignal.timeout(180000)});console.log(`Local watch scheduled invocation: HTTP ${response.status}`);}catch{console.error('Local watch scheduled invocation failed');}finally{scheduleLocalCheck();}},next.getTime()-now);
}
scheduleLocalCheck();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {clearTimeout(timer);child.kill(signal);});
child.on('exit', code => { clearTimeout(timer);process.exitCode = code ?? 0; });
