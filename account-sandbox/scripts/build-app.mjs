import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const result=spawnSync('npm',['run','build','--','--mode','account-lab','--outDir','account-sandbox/public/app'],{cwd:root,stdio:'inherit',env:{...process.env,VITE_ACCOUNT_LAB:'1',VITE_PAGES_BASE:'/app/'}});
process.exitCode=result.status??1;
