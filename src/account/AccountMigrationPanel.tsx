import {useEffect,useRef,useState} from 'react';
import {accountRequest,workspace} from './storage';
import {decodeBase64,normalizeTransfer,sha256Hex,transferFingerprint,type TransferPackage} from './legacyTransfer';

type Preview={revision:number;upload:{kind:'attachments'|'backups';id:string;size:number;sha256:string}[];counts:{newRecords:number;duplicateRecords:number;recordConflicts:number;newFiles:number;duplicateFiles:number;fileConflicts:number};conflictingAttachmentIds:string[]};
type Receipt={id:string;state:'committed'|'rolled_back';created_at:string};
const words={
  ja:{title:'以前の Yami データを移行',description:'別の Yami で作成した移行ファイルを選択します。元のデータは読み取りのみで、ログイン後のデータへ自動反映されません。',exportHint:'以前の Yami から「アカウント移行データ」を書き出してから選択してください。添付ファイルと保存済みバックアップも含められます。',choose:'移行ファイルを選択',review:'内容を確認',empty:'移行ファイルはまだ選択されていません。',records:'新規データ',duplicates:'重複',conflicts:'競合（既存を保持）',files:'添付・バックアップ',missing:'添付ファイルが不足しています。完全な移行ファイルを選び直してください。',oversized:'1 ファイルがローカルテスト上限の 1 MB を超えています。データは変更されていません。',confirm:'現在のアカウントを完全バックアップしてから、競合しない項目だけを追加します。既存項目は上書きされません。実行しますか？',run:'バックアップして移行',working:'移行中…',done:'移行が完了しました。再読み込みして反映してください。',reload:'再読み込み',rollback:'直前の移行をロールバック',rollbackConfirm:'移行前のアカウント全体に戻します。移行後に追加・変更した内容も失われます。続行しますか？',rolled:'移行前の状態へ戻しました。再読み込みしてください。',noRollback:'ロールバック可能な移行はありません。',error:'移行を完了できませんでした。元データと現在のアカウントは保持されています。もう一度確認してください。',integrity:'ファイルの整合性を確認できませんでした。',backupSource:'通常の JSON バックアップは添付バイナリを含まない場合があります。添付が必要な場合は完全なアカウント移行ファイルをご利用ください。',separate:'既読状態や設定はユーザーごとに統合します。監視接続トークンや共有監視データは移行しません。'},
  zh:{title:'迁移旧版 Yami 数据',description:'选择在另一 Yami 环境中生成的迁移文件。源数据仅读取，不会在登录后自动导入。',exportHint:'请先在旧版 Yami 导出“账户迁移包”，再在此选择。迁移包可包含附件和已保存备份。',choose:'选择迁移文件',review:'检查内容',empty:'尚未选择迁移文件。',records:'新增记录',duplicates:'重复记录',conflicts:'冲突（保留现有）',files:'附件与备份',missing:'发现缺少附件。请重新选择包含完整附件的迁移包。',oversized:'有单个文件超过本地测试上限 1 MB。数据未被修改。',confirm:'将先完整备份当前账户，再仅追加无冲突的数据。不会覆盖现有记录。确定继续吗？',run:'备份并迁移',working:'正在迁移…',done:'迁移完成，请重新加载以应用数据。',reload:'重新加载',rollback:'回滚最近一次迁移',rollbackConfirm:'将整个账户恢复到迁移前。迁移后新增或修改的数据也会丢失。确定继续吗？',rolled:'已恢复迁移前状态，请重新加载。',noRollback:'没有可回滚的迁移。',error:'迁移未能完成。源数据和当前账户均已保留，请检查后重试。',integrity:'无法验证迁移文件完整性。',backupSource:'普通 JSON 备份可能不含附件二进制。需要附件时，请使用完整账户迁移包。',separate:'已读状态和设置按用户合并。不会迁移监控会话令牌或共享监控数据。'}
};
export function AccountMigrationPanel({locale}:{locale:string}){
  const language=locale==='ja'?'ja':'zh',t=words[language],input=useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<TransferPackage|null>(null),[preview,setPreview]=useState<Preview|null>(null),[problem,setProblem]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(''),[latest,setLatest]=useState<Receipt|null>(null);
  const owner=workspace.owner;
  const loadLatest=async()=>{try{const value=await(await accountRequest('/api/migrations/latest',{},owner)).json();setLatest(value.latest??null);}catch{setLatest(null);}};
  useEffect(()=>{void loadLatest();},[owner]);
  const choose=async(selected?:File)=>{
    setFile(null);setPreview(null);setProblem('');setDone('');if(!selected)return;
    try{
      const raw=JSON.parse(await selected.text());const parsed=normalizeTransfer(raw) as TransferPackage;
      for(const asset of parsed.assets){const digest=await sha256Hex(decodeBase64(asset.contentBase64));if(digest!==asset.sha256)throw new Error('integrity');}
      const fingerprint=await transferFingerprint(parsed.storage,parsed.assets);if(parsed.fingerprint&&parsed.fingerprint!==fingerprint)throw new Error('integrity');
      const current=await(await accountRequest('/api/files/attachments',{},owner)).json() as {files:{id:string}[]};
      const have=new Set(current.files.map(item=>item.id)),included=new Set(parsed.assets.filter(item=>item.kind==='attachments').map(item=>item.id));
      const data=JSON.parse(parsed.storage['career-flow-data-v5']) as {materials?:{attachmentId?:string}[]};
      const missing=(data.materials??[]).some(item=>item.attachmentId&&!have.has(item.attachmentId)&&!included.has(item.attachmentId));
      if(missing){setProblem('missing');return;}
      const manifest=parsed.assets.map(({kind,id,size,sha256})=>({kind,id,size,sha256}));
      const result=await(await accountRequest('/api/migrations/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({storage:parsed.storage,manifest})},owner)).json() as Preview;
      if(workspace.owner!==owner)throw new Error('ACCOUNT_CHANGED');
      setFile({...parsed,fingerprint});setPreview(result);
    }catch(error){setProblem(error instanceof Error&&error.message==='integrity'?'integrity':'error');}
  };
  const run=async()=>{
    if(!file||!preview||busy||!confirm(t.confirm))return;
    setBusy(true);setProblem('');setDone('');let importId='';
    try{
      const manifest=file.assets.map(({kind,id,size,sha256})=>({kind,id,size,sha256}));
      const started=await(await accountRequest('/api/migrations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fingerprint:file.fingerprint,expectedRevision:preview.revision,manifest,storage:file.storage})},owner)).json() as {id:string;upload:Preview['upload']};importId=started.id;
      for(const item of started.upload){
        const asset=file.assets.find(candidate=>candidate.kind===item.kind&&candidate.id===item.id);if(!asset)throw new Error('MISSING_ASSET');
        const bytes=decodeBase64(asset.contentBase64);
        const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
        await accountRequest(`/api/migrations/${encodeURIComponent(importId)}/files/${item.kind}/${encodeURIComponent(item.id)}`,{method:'PUT',headers:{'content-type':asset.mediaType},body:buffer},owner);
      }
      await accountRequest(`/api/migrations/${encodeURIComponent(importId)}/commit`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'},owner);
      await loadLatest();setDone('done');setFile(null);setPreview(null);
    }catch{
      if(importId)await accountRequest(`/api/migrations/${encodeURIComponent(importId)}/abort`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'},owner).catch(()=>undefined);
      setProblem('error');
    }finally{setBusy(false);}
  };
  const rollback=async()=>{
    if(!latest||busy||!confirm(t.rollbackConfirm))return;setBusy(true);setProblem('');
    try{await accountRequest(`/api/migrations/${encodeURIComponent(latest.id)}/rollback`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'},owner);setLatest({...latest,state:'rolled_back'});setDone('rolled');}
    catch{setProblem('error');}finally{setBusy(false);}
  };
  const tooLarge=Boolean(file?.assets.some(asset=>asset.size>1_000_000));
  return <section className="account-migration" aria-labelledby="account-migration-title">
    <h4 id="account-migration-title">{t.title}</h4><p>{t.description}</p><small>{t.exportHint}</small>
    <div className="account-migration-actions"><input ref={input} type="file" accept="application/json,.json" hidden onChange={event=>void choose(event.target.files?.[0])}/><button type="button" disabled={busy} onClick={()=>input.current?.click()}>{t.choose}</button></div>
    {file&&preview&&<div className="account-migration-review"><strong>{t.review}</strong><dl><div><dt>{t.records}</dt><dd>{preview.counts.newRecords}</dd></div><div><dt>{t.duplicates}</dt><dd>{preview.counts.duplicateRecords+preview.counts.duplicateFiles}</dd></div><div><dt>{t.conflicts}</dt><dd>{preview.counts.recordConflicts+preview.counts.fileConflicts}</dd></div><div><dt>{t.files}</dt><dd>{preview.counts.newFiles}/{file.assets.length}</dd></div></dl><small>{t.separate}</small><small>{t.backupSource}</small>{tooLarge&&<p role="alert">{t.oversized}</p>}<button type="button" className="primary" disabled={busy||tooLarge} onClick={()=>void run()}>{busy?t.working:t.run}</button></div>}
    {!file&&!done&&<p className="account-migration-empty">{t.empty}</p>}
    {done&&<p role="status">{t[done as 'done'|'rolled']} <button type="button" onClick={()=>location.reload()}>{t.reload}</button></p>}
    {problem&&<p role="alert">{t[problem as 'missing'|'oversized'|'integrity'|'error']}</p>}
    {latest?.state==='committed'&&<button type="button" className="account-migration-rollback" disabled={busy} onClick={()=>void rollback()}>{t.rollback}</button>}
  </section>;
}
