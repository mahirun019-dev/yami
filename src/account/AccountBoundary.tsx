import {Fragment,createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {ACCOUNT_MODE,ACCOUNT_ORIGIN,accountRequest,workspace} from './storage.ts';
import './account.css';
import {accountErrorLabels} from './i18n';
import {recoverySnapshot} from './recovery';
import {AccountMigrationPanel} from './AccountMigrationPanel';
type User={userId:string;email:string;expiresAt:string};
type Value={user:User;refresh():Promise<void>;logout():Promise<void>};
const Context=createContext<Value|null>(null);
let hydration:Promise<void>|null=null;
let hydratedOwner='';
async function hydrateAccount(owner:string){
  if(hydration&&workspace.owner===owner){await hydration;return;}
  if(workspace.owner!==owner||hydratedOwner!==owner){
    workspace.reset(owner);
    hydratedOwner='';
    const load=async()=>{const document=await(await accountRequest('/api/workspace',{},owner)).json();if(workspace.owner!==owner)throw new Error('ACCOUNT_CHANGED');workspace.reset(owner,document);hydratedOwner=owner;};
    const pending=load();hydration=pending;
    try{await pending;}finally{if(hydration===pending)hydration=null;}
  }else if(hydration)await hydration;
}
export const useAccount=()=>useContext(Context);
const words={ja:{title:'Yami アカウント開発環境',intro:'独立したテストデータで Yami を利用します。既存の匿名データや企業ウォッチは自動移行されません。',login:'Google ログインへ',loading:'アカウントを確認中…',retry:'再試行',account:'アカウント',logout:'ログアウト',sync:'保存済み',pending:'保存中',failure:'保存できません。データを失わないよう、このページを閉じずに再試行してください。',conflict:'別の画面で更新されています。自動上書きは停止しました。下書きを書き出してから再読み込みしてください。',download:'未同期データを書き出す',refresh:'状態を再確認'},zh:{title:'Yami 账户开发环境',intro:'使用独立测试数据体验 Yami。不会自动迁移现有匿名数据或共享企业监控。',login:'前往 Google 登录',loading:'正在核实账户…',retry:'重试',account:'账户',logout:'退出登录',sync:'已保存',pending:'保存中',failure:'保存失败。请勿关闭页面，以免丢失未同步数据，请重试。',conflict:'另一页面已更新数据，已停止自动覆盖。请先导出未同步草稿，再重新加载。',download:'导出未同步数据',refresh:'重新核实状态'}};
export function AccountBoundary({children}:{children:ReactNode}){
  const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[locale,setLocale]=useState<'ja'|'zh'>('ja');
  const [,update]=useState(0);const t=words[locale];
  async function refresh(){
    if(location.origin!==ACCOUNT_ORIGIN)throw new Error('LOCAL_ACCOUNT_TEST_ONLY');
    const response=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('SESSION_UNAVAILABLE');
    const session=await response.json();
    if(!session.authenticated){workspace.reset();setUser(null);setReady(true);return;}
    const next:User=session.user;
    if(workspace.owner!==next.userId){setReady(false);}
    await hydrateAccount(next.userId);
    setUser(next);setReady(true);setError('');
    if(workspace.owner!==next.userId)throw new Error('ACCOUNT_CHANGED');
  }
  useEffect(()=>{
    if(!ACCOUNT_MODE)return;
    const check=()=>void refresh().catch(()=>setError('ACCOUNT_UNAVAILABLE'));
    const expired=()=>{workspace.reset();setUser(null);setReady(true);};
    const visible=()=>{if(document.visibilityState==='visible')check();};
    const beforeLeave=(event:BeforeUnloadEvent)=>{if(workspace.dirty){event.preventDefault();event.returnValue='';}};
    const unsub=workspace.subscribe(()=>{update(n=>n+1);setLocale(workspace.getItem('careerflow-locale')==='ja'?'ja':'zh');});
    check();const timer=setInterval(visible,60000);
    window.addEventListener('yami-account-expired',expired);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);window.addEventListener('beforeunload',beforeLeave);
    return()=>{clearInterval(timer);unsub();window.removeEventListener('yami-account-expired',expired);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);window.removeEventListener('beforeunload',beforeLeave);};
  },[]);
  const logout=async()=>{const owner=user?.userId;await workspace.flush();if(!owner||workspace.owner!==owner)throw new Error('ACCOUNT_CHANGED');const result=await fetch('/auth/logout',{method:'POST',headers:{'content-type':'application/json','x-yami-user':owner},body:'{}'});if(!result.ok)throw new Error('LOGOUT_FAILED');workspace.reset();setUser(null);};
  const login=async()=>{try{if(location.origin!==ACCOUNT_ORIGIN)throw new Error('LOCAL_ACCOUNT_TEST_ONLY');const response=await fetch('/auth/google/start?app=1',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const value=await response.json();const target=new URL(value.url);if(!response.ok||target.origin!=='https://accounts.google.com')throw new Error('LOGIN_FAILED');location.assign(target.href);}catch{setError('LOGIN_FAILED');}};
  if(!ACCOUNT_MODE)return children;
  if(!ready||!user||error)return <main className="account-gate"><select aria-label="Language" value={locale} onChange={event=>setLocale(event.target.value as 'ja'|'zh')}><option value="ja">日本語</option><option value="zh">简体中文</option></select><h1>{t.title}</h1><p>{!ready&&!error?t.loading:t.intro}</p>{error&&<p role="alert">{accountErrorLabels[locale]}</p>}<button disabled={!ready} onClick={()=>void login()}>{t.login}</button>{error&&<button onClick={()=>void refresh().catch(()=>setError('ACCOUNT_UNAVAILABLE'))}>{t.retry}</button>}</main>;
  return <Context.Provider value={{user,refresh,logout}}><Fragment key={user.userId}>{children}</Fragment>{workspace.error&&<aside className="account-sync-error" role="alert">{workspace.error==='WORKSPACE_CONFLICT'?t.conflict:t.failure}<button onClick={()=>void workspace.flush().catch(()=>{})}>{t.retry}</button><button onClick={()=>{const file=new Blob([JSON.stringify(recoverySnapshot(workspace.snapshot()),null,2)],{type:'application/json'});const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download='yami-account-unsynced.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>{t.download}</button></aside>}</Context.Provider>;
}
export function AccountPanel({locale}:{locale:string}){
  const account=useAccount(),[busy,setBusy]=useState(false),[error,setError]=useState('');const [,redraw]=useState(0);
  useEffect(()=>workspace.subscribe(()=>redraw(n=>n+1)),[]);
  if(!ACCOUNT_MODE||!account)return null;
  const t=words[locale==='ja'?'ja':'zh'];
  const language=locale==='ja'?'ja':'zh';
  const act=async(action:'logout'|'refresh')=>{setBusy(true);setError('');try{await workspace.flush();await account[action]();}catch{setError(accountErrorLabels[language]);}finally{setBusy(false);}};
  return <section className="account-panel"><h3>{t.account}</h3><p>{account.user.email}</p><small>{workspace.dirty?t.pending:t.sync}</small><div className="account-actions"><button disabled={busy} onClick={()=>void act('refresh')}>{t.refresh}</button><button disabled={busy} onClick={()=>void act('logout')}>{t.logout}</button></div><AccountMigrationPanel locale={locale}/>{error&&<p role="alert">{error}</p>}</section>;
}
