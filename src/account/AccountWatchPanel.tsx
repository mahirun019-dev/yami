import {useEffect,useState} from 'react';
import {accountRequest,workspace} from './storage';
type Target={id:string;company_name:string;url:string;status:string;health_status:string|null;last_checked_at:string|null;entry_status:string|null};
type Event={id:string;title:string;summary:string;read:number};
export function AccountWatchPanel({locale}:{locale:string}){
 const ja=locale==='ja',owner=workspace.owner;
 const companies=JSON.parse(workspace.getItem('career-flow-data-v5')||'{"companies":[]}').companies as {id:string;name:string}[];
 const [targets,setTargets]=useState<Target[]>([]),[events,setEvents]=useState<Event[]>([]),[company,setCompany]=useState(companies[0]?.id||''),[url,setUrl]=useState(''),[source,setSource]=useState('official'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=async()=>{const value=await(await accountRequest('/api/watch/targets',{},owner)).json();if(workspace.owner!==owner)return;setTargets(value.targets);setEvents(value.events);};
 useEffect(()=>{void load().catch(()=>setError(ja?'読み込めませんでした':'加载失败'));},[owner]);
 const act=async(path:string,method:string,body?:unknown)=>{setBusy(true);setError('');try{await accountRequest(path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},owner);await load();}catch{setError(ja?'処理に失敗しました。状態を再確認してください。':'操作失败，请重新核实状态。');}finally{setBusy(false);}};
 return <section className="account-panel account-watch-panel"><h3>{ja?'アカウント企業ウォッチ':'账户企业监控'}</h3><p>{ja?'ローカル開発環境専用。登録直後は未確認で、実際のチェック結果を表示します。正式版の監視は変更しません。':'仅限本地开发环境。登记后先显示未检查，再展示真实检查结果；不改变正式版监控。'}</p>
 <form onSubmit={event=>{event.preventDefault();const selected=companies.find(item=>item.id===company);if(selected)void act('/api/watch/targets','POST',{companyId:selected.id,companyName:selected.name,url,sourceType:source});}}>
 <label>{ja?'企業':'企业'}<select value={company} onChange={event=>setCompany(event.target.value)}>{companies.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
 <label>{ja?'監視先':'来源'}<select value={source} onChange={event=>setSource(event.target.value)}><option value="official">{ja?'公式採用ページ':'官方招聘页'}</option><option value="mynavi">MyNavi</option><option value="other">{ja?'その他':'其他'}</option></select></label><label>URL<input type="url" required value={url} onChange={event=>setUrl(event.target.value)}/></label><button disabled={busy||!company}>{ja?'登録':'登记'}</button></form>
 <div className="account-actions"><button disabled={busy} onClick={()=>void act('/api/watch/run','POST')}>{busy?(ja?'実行中…':'运行中…'):(ja?'ローカルチェックを実行':'运行本地检查')}</button><button disabled={busy} onClick={()=>void load().catch(()=>setError(ja?'読み込めませんでした':'加载失败'))}>{ja?'再読み込み':'刷新'}</button></div>
 {error&&<p role="alert">{error}</p>}{targets.map(target=><article key={target.id}><strong>{target.company_name}</strong><p className="account-watch-url">{target.url}</p><p>{target.last_checked_at?`${target.health_status||target.status} · ${new Date(target.last_checked_at).toLocaleString(ja?'ja-JP':'zh-CN')}`:(ja?'登録済み・未チェック':'已登记・尚未检查')}{target.entry_status?` · Entry: ${target.entry_status}`:''}</p><button disabled={busy} onClick={()=>void act('/api/watch/targets/'+target.id,'DELETE')}>{ja?'登録を解除':'取消登记'}</button></article>)}
 <h4>{ja?'このアカウントの通知':'此账户的通知'}</h4>{events.length?events.map(item=><article key={item.id}><strong>{item.title}</strong><p>{item.summary}</p>{!item.read&&<button onClick={()=>void act('/api/watch/events/'+item.id+'/read','POST')}>{ja?'既読にする':'标为已读'}</button>}</article>):<p>{ja?'通知はありません':'暂无通知'}</p>}</section>;
}
