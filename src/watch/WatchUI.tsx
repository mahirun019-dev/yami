import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bell, ExternalLink, Eye, MoreHorizontal, Pause, Pencil, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { watchText } from './i18n';
import { companyWatchKey, useWatch } from './WatchProvider';
import type { SourceHealthStatus, WatchEvent, WatchSource } from './types';
import { YamiBrandAvatar, YamiWordmark } from '../brand/YamiLogo';
import { getUnreadProductUpdateCount, loadReadProductUpdateIds, PRODUCT_UPDATES, saveReadProductUpdateIds, subscribeProductUpdateReadState } from './productUpdates';

type Locale = 'ja' | 'zh';
const formatDate = (value: string | null, locale: Locale, dateOnly = false) => value ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'zh-CN', { month: 'numeric', day: 'numeric', ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit' }) }).format(new Date(value)) : '—';

function targetStatus(target: import('./types').WatchTarget, text: typeof watchText.ja | typeof watchText.zh, locale: Locale, checkingTimedOut = false) {
  if (!target.enabled) return { tone: 'paused', label: text.paused, detail: '' };
  if (target.status === 'checking' && checkingTimedOut) return { tone: 'checking', label: text.checkingTimeout, detail: '' };
  if (target.status === 'checking') return { tone: 'checking', label: text.checking, detail: target.last_success_at ? `${text.lastSuccess} ${formatDate(target.last_success_at, locale)}` : '' };
  if (target.health_status && target.health_status !== 'healthy') return { tone: 'active', label: text.active, detail: '' };
  if (target.status === 'error' || target.last_error) return { tone: 'error', label: text.error, detail: target.last_success_at ? `${text.lastSuccess} ${formatDate(target.last_success_at, locale)}` : '' };
  if (target.last_success_at) return { tone: 'active', label: text.active, detail: `${text.lastCheck} ${formatDate(target.last_checked_at, locale)}` };
  return { tone: 'checking', label: text.checking, detail: text.unchecked };
}

function targetErrorText(error: string, text: typeof watchText.ja | typeof watchText.zh) {
  if (error === 'ROBOTS_DISALLOWED') return text.robotsDisallowed;
  if (error === 'ROBOTS_POLICY_UNVERIFIABLE') return text.robotsUnverifiable;
  if (error === 'INSUFFICIENT_PUBLIC_CONTENT') return text.insufficientContent;
  return error;
}

function sourceHealthLabel(status: SourceHealthStatus | null | undefined, locale: Locale) {
  const ja = locale === 'ja';
  if (status === 'healthy') return ja ? '正常' : '正常';
  if (status === 'identity_mismatch') return ja ? '要確認' : '需确认';
  if (status === 'extraction_failed') return ja ? '取得失敗' : '获取失败';
  if (status === 'unreachable') return ja ? 'アクセス不可' : '无法访问';
  if (status === 'auth_required') return ja ? '認証が必要' : '需要登录';
  if (status === 'source_changed') return ja ? '構造変更・要確認' : '结构变化·需确认';
  if (status === 'needs_review') return ja ? '要確認' : '需确认';
  return ja ? '未確認' : '未检查';
}

function sourceHealthReason(status: SourceHealthStatus | null | undefined, detail: string | null | undefined, locale: Locale) {
  const ja = locale === 'ja';
  if (status === 'identity_mismatch') return ja ? '監視先ページの企業名が登録企業と一致しません。URLを確認してください。' : '监控页面中的企业名称与登记企业不一致，请核对网址。';
  if (status === 'extraction_failed') return ja ? '企業固有の採用情報を取得できませんでした。ページ構成を確認してください。' : '无法提取该企业的招聘主体信息，请检查页面结构。';
  if (status === 'unreachable') return ja ? '監視先ページにアクセスできません。URLや公開状態を確認してください。' : '无法访问监控页面，请检查网址或页面状态。';
  if (status === 'auth_required') return ja ? '監視先の閲覧にログインまたは追加の権限が必要です。' : '访问监控页面需要登录或额外权限。';
  if (status === 'source_changed') return ja ? 'ページ構造が変わったため、差分通知を停止しています。内容を確認してください。' : '页面结构发生变化，已暂停差异通知，请确认监控内容。';
  if (status === 'needs_review') return detail === 'ROBOTS_DISALLOWED' || detail === 'ROBOTS_POLICY_UNVERIFIABLE'
    ? (ja ? '取得ルールを確認できないため、内容の更新確認を停止しています。' : '无法确认页面抓取规则，已暂停内容更新检查。')
    : (ja ? '登録企業との一致を確認できませんでした。監視先を確認してください。' : '无法确认页面与登记企业一致，请检查监控来源。');
  return ja ? '監視先を確認してください。' : '请检查监控来源。';
}

export function CompanyWatchSection({ company, locale, openSettings, highlightEventId }: { company: { id: string; name: string }; locale: Locale; openSettings(): void; highlightEventId?: string }) {
  const text = watchText[locale], watch = useWatch();
  const [formOpen, setFormOpen] = useState(false), [editingId, setEditingId] = useState<string | null>(null), [sourceType, setSourceType] = useState<WatchSource>('official'), [url, setUrl] = useState(''), [label, setLabel] = useState(''), [message, setMessage] = useState(''), [healthPrompt, setHealthPrompt] = useState<{ status: SourceHealthStatus; detail: string | null; detectedCompanyName: string | null } | null>(null), [notice, setNotice] = useState(''), [noticeTargetId, setNoticeTargetId] = useState<string | null>(null), [actionsFor, setActionsFor] = useState<string | null>(null);
  const companyKey = companyWatchKey(company.name);
  const targets = watch.targets.filter((target) => target.company_id === company.id || companyWatchKey(target.company_name) === companyKey);
  const updates = watch.events.filter((event) => event.company_id === company.id || companyWatchKey(event.company_name) === companyKey);
  useEffect(() => {
    if (!highlightEventId || !updates.some((event) => event.id === highlightEventId)) return;
    const element = document.getElementById(`company-watch-update-${highlightEventId}`);
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.classList.add('is-highlighted');
    const timeout = window.setTimeout(() => element.classList.remove('is-highlighted'), 1800);
    return () => window.clearTimeout(timeout);
  }, [highlightEventId, updates]);
  useEffect(() => {
    if (!noticeTargetId) return;
    const checked = watch.targets.find((target) => target.id === noticeTargetId);
    if (checked && checked.status !== 'checking') {
      setNotice('');
      setNoticeTargetId(null);
    }
  }, [noticeTargetId, watch.targets]);
  const saveSource = async (confirmUnverified = false) => {
    setMessage('');
    try {
      const response = await watch.request(editingId ? `/api/targets/${editingId}` : '/api/targets', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify({ companyId: company.id, companyName: company.name, sourceType, url, label, confirmUnverified }) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 422 && body.error === 'SOURCE_HEALTH_CONFIRMATION_REQUIRED' && body.sourceHealth) {
        setHealthPrompt(body.sourceHealth);
        setMessage(text.preflightRequired);
        return;
      }
      if (!response.ok) { setMessage(body.error === 'DUPLICATE_URL' ? text.duplicate : text.invalid); return; }
      const submittedTargetId = typeof body.id === 'string' ? body.id : null;
      const checking = body.status === 'checking';
      if (!editingId && checking && submittedTargetId) watch.trackCheck(submittedTargetId);
      setNotice(editingId ? '' : body.duplicate ? checking ? text.duplicateChecking : text.duplicatePaused : body.sourceHealth?.status === 'healthy' ? text.addedValidated : text.addedNeedsReview);
      setNoticeTargetId(!editingId && checking ? submittedTargetId : null);
      setFormOpen(false); setEditingId(null); setUrl(''); setLabel(''); setHealthPrompt(null); await watch.refresh();
    } catch { setMessage(text.unavailable); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void saveSource(); };
  const changeEnabled = async (target: import('./types').WatchTarget) => {
    const response = await watch.request(`/api/targets/${target.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !target.enabled }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.status === 'checking') watch.trackCheck(target.id);
    await watch.refresh();
    setActionsFor(null);
  };
  const remove = async (target: import('./types').WatchTarget) => { await watch.request(`/api/targets/${target.id}`, { method: 'DELETE' }); await watch.refresh(); setActionsFor(null); };
  const edit = (target: import('./types').WatchTarget) => { setEditingId(target.id); setSourceType(target.source_type); setUrl(target.url); setLabel(target.label); setHealthPrompt(null); setMessage(''); setFormOpen(true); setActionsFor(null); };
  const actionTarget = targets.find((target) => target.id === actionsFor);
  return <section id="company-watch" className="company-watch-section detail-section">
    <div className="company-watch-heading"><h2>{text.title}</h2>{watch.authenticated && <button type="button" className="text-button" onClick={() => { setEditingId(null); setSourceType('official'); setUrl(''); setLabel(''); setMessage(''); setHealthPrompt(null); setNotice(''); setFormOpen(true); }}><Plus />{text.add}</button>}</div>
    {notice && <p className="company-watch-notice" role="status">{notice}</p>}
    {!watch.configured ? <p className="company-watch-muted">{text.unavailable}</p> : !watch.authenticated ? <div className="company-watch-connect"><p>{text.notConnected}</p><button type="button" className="text-button" onClick={openSettings}>{text.settings}<ExternalLink /></button></div> : targets.length ? <div className="watch-target-list">{targets.map((target) => {
      const status = targetStatus(target, text, locale, watch.checkingTimedOut.includes(target.id));
      return <article className="watch-target-item" key={target.id}>
      <div className="watch-target-copy"><strong>{target.label || text[target.source_type]}</strong><a href={target.url} target="_blank" rel="noreferrer" title={target.url}>{new URL(target.url).host}{new URL(target.url).pathname}<ExternalLink /></a><small className={`watch-status ${status.tone}`}>{status.label}{status.detail ? ` · ${status.detail}` : ''}</small>{target.health_status && target.health_status !== 'healthy' && <small className="watch-health-inline" data-health={target.health_status}>{sourceHealthLabel(target.health_status, locale)} · {sourceHealthReason(target.health_status, target.health_detail, locale)}{target.detected_company_name ? ` ${text.detectedCompany}: ${target.detected_company_name}` : ''}</small>}{target.last_error && !target.health_status && <small title={target.last_error}>{targetErrorText(target.last_error, text)}</small>}</div>
      <div className="watch-target-actions">
        <button className="watch-target-actions-more" title={locale === 'ja' ? '操作' : '操作'} onClick={() => setActionsFor(target.id)}><MoreHorizontal /></button>
        <div className="watch-target-actions-desktop"><button title={text.edit} onClick={() => edit(target)}><Pencil /></button>
        {target.status === 'error' && <button title={text.retry} onClick={async () => { const response = await watch.request(`/api/targets/${target.id}/retry`, { method: 'POST' }); const body = await response.json().catch(() => ({})); if (response.ok && body.status === 'checking') watch.trackCheck(target.id); await watch.refresh(); }}><RefreshCw /></button>}
        <button title={target.enabled ? text.pause : text.resume} onClick={() => void changeEnabled(target)}>{target.enabled ? <Pause /> : <Play />}</button>
        <button title={text.remove} className="danger-icon" onClick={() => void remove(target)}><Trash2 /></button></div>
      </div>
    </article>; })}</div> : <div className="company-watch-empty"><Eye /><p>{text.empty}</p><button type="button" onClick={() => setFormOpen(true)}><Plus />{text.add}</button></div>}
    {formOpen && <div className="modal-layer watch-dialog-layer"><button className="modal-backdrop" aria-label={text.cancel} onClick={() => setFormOpen(false)} /><section className="drawer entity-card watch-dialog" role="dialog" aria-modal="true"><header><h2>{text.add}</h2><button className="close-button" onClick={() => setFormOpen(false)} aria-label={text.cancel}><X /></button></header><form onSubmit={submit}><div className="form-grid"><label>{text.source}<select value={sourceType} onChange={(e) => { setSourceType(e.target.value as WatchSource); setHealthPrompt(null); }}><option value="mynavi">{text.mynavi}</option><option value="official">{text.official}</option><option value="other">{text.other}</option></select></label><label>{text.url}<input type="url" required value={url} onChange={(e) => { setUrl(e.target.value); setHealthPrompt(null); }} placeholder="https://" /></label><label>{text.label}<input value={label} onChange={(e) => setLabel(e.target.value)} /></label></div>{message && <p className="form-error">{message}</p>}{healthPrompt && <div className="watch-source-confirmation" role="alert"><strong>{sourceHealthReason(healthPrompt.status, healthPrompt.detail, locale)}</strong><dl><div><dt>{locale === 'ja' ? '登録企業' : '登记企业'}</dt><dd>{company.name}</dd></div>{healthPrompt.detectedCompanyName && <div><dt>{locale === 'ja' ? '検出された企業名' : '检测到的企业名称'}</dt><dd>{healthPrompt.detectedCompanyName}</dd></div>}</dl><button type="button" onClick={() => void saveSource(true)}>{text.confirmUnverified}</button></div>}<footer className="form-actions"><button type="button" onClick={() => setFormOpen(false)}>{text.cancel}</button><button className="primary" type="submit">{text.save}</button></footer></form></section></div>}
    {updates.length > 0 && <div className="company-watch-updates"><h3>{text.updates}</h3>{updates.map((event) => <article id={`company-watch-update-${event.id}`} className="company-watch-update" key={event.id}><div><strong>{event.title}</strong><p>{event.summary}</p></div><time>{formatDate(event.detected_at, locale)}</time></article>)}</div>}
    {actionTarget && createPortal(<div className="action-sheet-layer watch-target-action-layer"><button className="action-sheet-backdrop" aria-label={text.cancel} onClick={() => setActionsFor(null)} /><section className="action-sheet watch-target-action-sheet" role="dialog" aria-modal="true"><button type="button" onClick={() => edit(actionTarget)}>{text.edit}</button><button type="button" onClick={() => void changeEnabled(actionTarget)}>{actionTarget.enabled ? text.pause : text.resume}</button><button type="button" className="danger" onClick={() => void remove(actionTarget)}>{text.remove}</button><button type="button" className="cancel-action" onClick={() => setActionsFor(null)}>{text.cancel}</button></section></div>, document.body)}
  </section>;
}

function WatchLogin({ locale }: { locale: Locale }) { const text = watchText[locale], watch = useWatch(), [code, setCode] = useState(''), [error, setError] = useState(''); return <form className="watch-login" onSubmit={async (event) => { event.preventDefault(); try { await watch.connect(code); setCode(''); } catch { setError('AUTH_FAILED'); } }}><label>{text.code}<input type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} /></label><button className="primary">{text.connect}</button>{error && <small>{error}</small>}</form>; }

export function WatchConnectionSettings({ locale }: { locale: Locale }) {
  const text = watchText[locale], watch = useWatch();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState('');
  const [healthPrompt, setHealthPrompt] = useState<{ status: SourceHealthStatus; detail: string | null; detectedCompanyName: string | null; currentUrl: string } | null>(null);
  const [editError, setEditError] = useState('');
  const [checkingAll, setCheckingAll] = useState(false);
  const enabledCompanies = new Set(watch.targets.filter((target) => target.enabled).map((target) => target.company_id || companyWatchKey(target.company_name)).filter(Boolean));
  const enabledTargets = watch.targets.filter((target) => target.enabled);
  const exceptions = enabledTargets.filter((target) => target.health_status && target.health_status !== 'healthy' || !target.health_status && target.status === 'error');
  const healthyCount = enabledTargets.filter((target) => target.health_status === 'healthy').length;
  const needsReviewCount = enabledTargets.filter((target) => ['identity_mismatch', 'source_changed', 'needs_review'].includes(target.health_status || '')).length;
  const retrievalFailureCount = enabledTargets.filter((target) => ['extraction_failed', 'unreachable', 'auth_required'].includes(target.health_status || '')).length;
  const uncheckedCount = enabledTargets.filter((target) => !target.health_status && target.status !== 'error').length;
  const copy = locale === 'ja'
    ? { status: '接続状態', connected: '接続済み', purpose: '企業ページの更新を確認するための接続です。', manage: '監視する企業は各企業の設定から管理できます。', monitored: '監視中の企業', unavailable: '監視サービスはまだ設定されていません。', title: '企業ウォッチとの接続を解除しますか？', description: '接続を解除すると、企業ページの監視機能を利用できなくなります。', cancel: 'キャンセル', disconnect: '接続を解除', healthTitle: '監視先の状態', sourceCount: '監視先', runCheck: '監視先を一括チェック', healthy: '正常', needsReview: '要確認', retrievalFailure: '取得失敗', unchecked: '未確認', noIssues: '確認が必要な監視先はありません。', open: '監視先を開く', editUrl: 'URLを編集', recheck: '再確認', url: '監視先 URL', saveUrl: 'URLを確認して保存', confirmSave: '内容を確認して保存', cancelEdit: '編集を閉じる', detected: '検出された企業名', checked: '最終確認', preflightTitle: '保存前に監視先を確認してください。', checkQueued: '監視先の確認を開始しました。', preflightRequired: '監視先の確認が必要です。' }
    : { status: '连接状态', connected: '已连接', purpose: '此连接用于确认企业页面的更新。', manage: '可在各企业的设置中管理监视对象。', monitored: '监视中的企业', unavailable: '监控服务尚未配置。', title: '要断开企业监控连接吗？', description: '断开后将无法使用企业页面监视功能。', cancel: '取消', disconnect: '断开连接', healthTitle: '监控来源状态', sourceCount: '监控来源', runCheck: '批量检查监控来源', healthy: '正常', needsReview: '需确认', retrievalFailure: '获取失败', unchecked: '未检查', noIssues: '没有需要确认的监控来源。', open: '打开监控来源', editUrl: '编辑网址', recheck: '重新检查', url: '监控网址', saveUrl: '检查网址并保存', confirmSave: '确认内容并保存', cancelEdit: '关闭编辑', detected: '检测到的企业名称', checked: '最后检查', preflightTitle: '保存前请确认监控来源。', checkQueued: '已开始检查监控来源。', preflightRequired: '需要确认监控来源。' };
  const closeEditor = () => { setEditingTargetId(null); setHealthPrompt(null); setEditError(''); };
  const editTarget = (target: import('./types').WatchTarget) => { setEditingTargetId(target.id); setEditingUrl(target.url); setHealthPrompt(null); setEditError(''); };
  const saveTargetUrl = async (confirmUnverified = false) => {
    const target = watch.targets.find((item) => item.id === editingTargetId);
    if (!target) return;
    try {
      const response = await watch.request(`/api/targets/${target.id}`, { method: 'PATCH', body: JSON.stringify({ url: editingUrl, sourceType: target.source_type, confirmUnverified }) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 422 && body.error === 'SOURCE_HEALTH_CONFIRMATION_REQUIRED' && body.sourceHealth) {
        setHealthPrompt(body.sourceHealth);
        setEditError('');
        return;
      }
      if (!response.ok) { setEditError(body.error === 'DUPLICATE_URL' ? text.duplicate : body.error || copy.preflightRequired); return; }
      closeEditor();
      await watch.refresh();
    } catch { setEditError(text.unavailable); }
  };
  const runBulkCheck = async () => {
    setCheckingAll(true);
    try {
      const response = await watch.request('/api/health-check', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'LOAD_FAILED');
      for (const id of (body.queuedIds || []) as string[]) watch.trackCheck(id);
      await watch.refresh();
    } catch { setEditError(text.unavailable); }
    finally { setCheckingAll(false); }
  };
  useEffect(() => {
    if (!confirmDisconnect) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setConfirmDisconnect(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmDisconnect]);
  return <section className="watch-connection-settings settings-wide-content">
    <h3>{text.connection}</h3>
    <div className="watch-settings-description"><p>{copy.purpose}</p><p>{copy.manage}</p></div>
    {!watch.configured ? <p className="watch-connection-muted">{copy.unavailable}</p> : watch.authenticated ? <>
      <div className="watch-connection-status"><h4>{copy.status}</h4><p><span className="watch-connection-dot" aria-hidden="true" />{copy.connected}</p></div>
      <p className="watch-monitored-count">{copy.monitored}<strong>{enabledCompanies.size}{locale === 'ja' ? '社' : '家'}</strong></p>
      <section className="watch-health-panel" aria-labelledby="watch-health-title">
        <header><div><h4 id="watch-health-title">{copy.healthTitle}</h4><p>{copy.sourceCount} {enabledTargets.length}{locale === 'ja' ? '件' : '条'}</p></div><button type="button" className="watch-health-check-button" disabled={checkingAll || enabledTargets.some((target) => target.status === 'checking')} onClick={() => void runBulkCheck()}><RefreshCw aria-hidden="true" />{copy.runCheck}</button></header>
        <div className="watch-health-summary"><span data-tone="healthy">{copy.healthy}<strong>{healthyCount}</strong></span><span data-tone="review">{copy.needsReview}<strong>{needsReviewCount}</strong></span><span data-tone="failed">{copy.retrievalFailure}<strong>{retrievalFailureCount}</strong></span>{uncheckedCount > 0 && <span data-tone="unchecked">{copy.unchecked}<strong>{uncheckedCount}</strong></span>}</div>
        {exceptions.length ? <div className="watch-health-exception-list">{exceptions.map((target) => {
          const status = target.health_status || 'needs_review';
          return <article className="watch-health-exception" key={target.id}>
            <div className="watch-health-exception-main"><div className="watch-health-exception-heading"><strong>{target.company_name}</strong><span data-health={status}>{sourceHealthLabel(status, locale)}</span></div>
              <a className="watch-health-url" href={target.url} target="_blank" rel="noreferrer">{target.label || text[target.source_type]} · {new URL(target.url).host}{new URL(target.url).pathname}<ExternalLink aria-hidden="true" /></a>
              <p>{sourceHealthReason(target.health_status || status, target.health_detail || target.last_error, locale)}</p>
              {target.detected_company_name && <small>{copy.detected}: {target.detected_company_name}</small>}
              {(target.health_checked_at || target.last_checked_at) && <small>{copy.checked}: {formatDate(target.health_checked_at || target.last_checked_at, locale)}</small>}
              <div className="watch-health-actions"><a href={target.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{copy.open}</a><button type="button" onClick={() => editTarget(target)}><Pencil aria-hidden="true" />{copy.editUrl}</button><button type="button" disabled={target.status === 'checking'} onClick={async () => { const response = await watch.request(`/api/targets/${target.id}/retry`, { method: 'POST' }); const body = await response.json().catch(() => ({})); if (response.ok && body.status === 'checking') watch.trackCheck(target.id); await watch.refresh(); }}>{target.status === 'checking' ? <RefreshCw className="is-spinning" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{copy.recheck}</button></div>
            </div>
            {editingTargetId === target.id && <form className="watch-health-edit" onSubmit={(event) => { event.preventDefault(); void saveTargetUrl(); }}>
              <label>{copy.url}<input type="url" required value={editingUrl} onChange={(event) => { setEditingUrl(event.target.value); setHealthPrompt(null); setEditError(''); }} /></label>
              {healthPrompt && <div className="watch-health-confirmation" role="alert"><strong>{copy.preflightTitle}</strong><p>{sourceHealthReason(healthPrompt.status, healthPrompt.detail, locale)}</p><dl><div><dt>{locale === 'ja' ? '登録企業' : '登记企业'}</dt><dd>{target.company_name}</dd></div>{healthPrompt.detectedCompanyName && <div><dt>{copy.detected}</dt><dd>{healthPrompt.detectedCompanyName}</dd></div>}</dl><button type="button" onClick={() => void saveTargetUrl(true)}>{copy.confirmSave}</button></div>}
              {editError && <p role="alert">{editError}</p>}
              <footer><button type="button" onClick={closeEditor}>{copy.cancelEdit}</button><button type="submit">{copy.saveUrl}</button></footer>
            </form>}
          </article>;
        })}</div> : <p className="watch-health-no-issues">{copy.noIssues}</p>}
        {editError && !editingTargetId && <p className="watch-health-error" role="alert">{editError}</p>}
      </section>
      <button type="button" className="watch-disconnect-button" onClick={() => setConfirmDisconnect(true)}>{text.disconnect}</button>
    </> : <><p className="watch-connection-muted">{text.connectFromSettings}</p><WatchLogin locale={locale} /></>}
    {confirmDisconnect && createPortal(<div className="watch-disconnect-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmDisconnect(false); }}>
      <section className="watch-disconnect-dialog" role="alertdialog" aria-modal="true" aria-labelledby="watch-disconnect-title" aria-describedby="watch-disconnect-description">
        <h2 id="watch-disconnect-title">{copy.title}</h2><p id="watch-disconnect-description">{copy.description}</p>
        <footer><button type="button" onClick={() => setConfirmDisconnect(false)}>{copy.cancel}</button><button type="button" className="danger-button" onClick={() => { watch.disconnect(); setConfirmDisconnect(false); }}>{copy.disconnect}</button></footer>
      </section>
    </div>, document.body)}
  </section>;
}

type NotificationPageProps = { locale: Locale; openCompany(id: string, name?: string, eventId?: string): void; openSettings(): void };

type NotificationFeedItem =
  | { type: 'company'; id: string; detectedAt: string; read: boolean; companyName: string; title: string; summary: string; event: WatchEvent }
  | { type: 'product-update'; id: string; detectedAt: string; read: boolean; companyName: 'Yami'; title: string; summary: string; changes: string[] };

function dateGroup(value: string, locale: Locale, text: typeof watchText.ja | typeof watchText.zh) {
  const day = new Date(value); const today = new Date();
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(day, today)) return text.today;
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (same(day, yesterday)) return text.yesterday;
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'zh-CN', { month: 'long', day: 'numeric' }).format(day);
}

export function NotificationPage({ locale, openCompany, openSettings }: NotificationPageProps) {
  const text = watchText[locale], watch = useWatch();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [expandedNotificationId, setExpandedNotificationId] = useState<string | null>(null);
  const [readProductUpdateIds, setReadProductUpdateIds] = useState(loadReadProductUpdateIds);
  useEffect(() => subscribeProductUpdateReadState(() => setReadProductUpdateIds(loadReadProductUpdateIds())), []);
  const feed = useMemo<NotificationFeedItem[]>(() => {
    const companyItems: NotificationFeedItem[] = watch.authenticated ? watch.events.map((event) => ({
      type: 'company', id: event.id, detectedAt: event.detected_at, read: Boolean(event.read),
      companyName: event.company_name, title: event.title, summary: event.summary, event,
    })) : [];
    const uniqueUpdates = [...new Map(PRODUCT_UPDATES.map((update) => [update.id, update])).values()];
    const productItems: NotificationFeedItem[] = uniqueUpdates.map((update) => ({
      type: 'product-update', id: update.id, detectedAt: update.date,
      read: readProductUpdateIds.includes(update.id), companyName: 'Yami',
      title: update.title[locale], summary: update.summary[locale], changes: update.changes[locale],
    }));
    return [...companyItems, ...productItems].sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
  }, [locale, readProductUpdateIds, watch.authenticated, watch.events]);
  const visibleItems = useMemo(() => filter === 'unread' ? feed.filter((item) => !item.read) : feed, [feed, filter]);
  const groups = useMemo(() => visibleItems.reduce<Record<string, NotificationFeedItem[]>>((all, item) => { const key = dateGroup(item.detectedAt, locale, text); (all[key] ||= []).push(item); return all; }, {}), [visibleItems, locale, text]);
  const choose = async (item: NotificationFeedItem) => {
    if (!item.read && item.type === 'company') await watch.markRead(item.id);
    if (!item.read && item.type === 'product-update') {
      const next = [...new Set([...readProductUpdateIds, item.id])];
      saveReadProductUpdateIds(next);
      setReadProductUpdateIds(next);
    }
    setExpandedNotificationId((current) => current === item.id ? null : item.id);
  };
  const markAllRead = async () => {
    const next = [...new Set([...readProductUpdateIds, ...PRODUCT_UPDATES.map((update) => update.id)])];
    saveReadProductUpdateIds(next);
    setReadProductUpdateIds(next);
    if (watch.authenticated && watch.events.some((event) => !event.read)) await watch.markAllRead();
  };
  const hasUnread = feed.some((item) => !item.read);
  return <section className="notification-page">
    <header className="notification-page-head"><div><h1>{text.notifications}</h1><p>{locale === 'ja' ? 'Yamiと企業の重要なお知らせを確認できます。' : '查看 Yami 和企业的重要更新。'}</p></div><button type="button" className="text-button" onClick={() => void markAllRead()} disabled={!hasUnread}>{text.markAllRead}</button></header>
    <div className="notification-page-filters" role="tablist"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>{text.all}</button><button className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>{text.unread}</button></div>
    {visibleItems.length ? <div className="notification-day-groups">{Object.entries(groups).map(([day, group]) => <section key={day}><h2>{day}</h2><div>{group.map((item) => {
        const expanded = expandedNotificationId === item.id;
        const productUpdate = item.type === 'product-update';
        const event = productUpdate ? null : item.event;
        return <article className={`notification-page-item${item.read ? ' is-read' : ''}${expanded ? ' is-expanded' : ''}${productUpdate ? ' is-product-update' : ''}`} key={item.id}>
          <button type="button" className={`notification-page-row${item.read ? ' is-read' : ''}${productUpdate ? ' has-product-brand' : ''}`} aria-expanded={expanded} onClick={() => void choose(item)}>{productUpdate ? <span className="notification-page-brand" aria-hidden="true"><YamiBrandAvatar alt="" />{!item.read && <span className="notification-page-dot" />}</span> : !item.read && <span className="notification-page-dot" aria-hidden="true" />}<span className="notification-page-copy">{productUpdate ? <strong className="notification-page-product-title"><YamiWordmark label="Yami" /><span>{item.title.replace(/^Yami/, '')}</span></strong> : <><strong>{item.companyName}</strong><b>{item.title}</b></>}<small>{item.summary}</small></span><time>{formatDate(item.detectedAt, locale, productUpdate)}</time></button>
          <div className="notification-page-detail" aria-hidden={!expanded}>{productUpdate ? <div className="notification-page-product-detail"><strong>{locale === 'ja' ? '今回のアップデート' : '本次更新'}</strong><ul>{item.changes.map((change) => <li key={change}>{change}</li>)}</ul></div> : event && <><dl><div><dt>{text.changes}</dt><dd>{event.summary}</dd></div><div><dt>{text.sourcePage}</dt><dd>{text[event.source_type]}</dd></div><div><dt>{text.detected}</dt><dd>{formatDate(event.detected_at, locale)}</dd></div>{event.before_excerpt && <div><dt>{text.before}</dt><dd>{event.before_excerpt}</dd></div>}{event.after_excerpt && <div><dt>{text.after}</dt><dd>{event.after_excerpt}</dd></div>}</dl><div className="notification-page-detail-actions"><button type="button" className="text-button" onClick={() => openCompany(event.company_id, event.company_name, event.id)}>{text.viewCompany}</button>{event.source_url && <a className="text-button" href={event.source_url} target="_blank" rel="noreferrer">{text.openSource}<ExternalLink /></a>}</div></>}</div>
        </article>;
      })}</div></section>)}</div> : <p className="notification-page-empty">{text.noUpdates}</p>}
    {!watch.configured && <p className="notification-page-connection-note">{text.unavailable}</p>}
    {watch.configured && !watch.authenticated && <div className="notification-page-connection-note"><span>{text.notConnected}</span><button type="button" className="text-button" onClick={openSettings}>{text.goToSettings}<ExternalLink /></button></div>}
  </section>;
}

export function CompanyWatchStatus({ companyId, companyName, locale }: { companyId: string; companyName: string; locale: Locale }) {
  const text = watchText[locale], watch = useWatch();
  if (!watch.authenticated) return null;
  const key = companyWatchKey(companyName);
  const matchesCompany = (item: { company_id: string; company_name: string }) => item.company_id === companyId || companyWatchKey(item.company_name) === key;
  const target = watch.targets.find((item) => matchesCompany(item));
  const unread = watch.events.filter((event) => matchesCompany(event) && !event.read).length;
  if (!target && !unread) return null;
  const status = target ? targetStatus(target, text, locale) : null;
  const healthNeedsReview = Boolean(target?.health_status && target.health_status !== 'healthy');
  return <span className={`company-watch-card-status${unread ? ' has-updates' : ''}${healthNeedsReview ? ' has-health-warning' : ''}`}>
    {!unread && status?.tone === 'active' && target?.health_status === 'healthy' && <span className="company-watch-active-dot" aria-hidden="true" />}
    {unread ? `● ${unread}${locale === 'ja' ? '件の更新' : ' 条更新'}` : `${target?.enabled ? text.active : status?.label}${healthNeedsReview ? ` · ${sourceHealthLabel(target?.health_status, locale)}` : ''}`}
  </span>;
}
