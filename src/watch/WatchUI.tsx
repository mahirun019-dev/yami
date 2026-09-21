import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bell, ExternalLink, Eye, MoreHorizontal, Pause, Pencil, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { watchText } from './i18n';
import { companyWatchKey, useWatch } from './WatchProvider';
import type { WatchEvent, WatchSource } from './types';
import { YamiBrandAvatar, YamiWordmark } from '../brand/YamiLogo';
import { getUnreadProductUpdateCount, loadReadProductUpdateIds, PRODUCT_UPDATES, saveReadProductUpdateIds, subscribeProductUpdateReadState } from './productUpdates';

type Locale = 'ja' | 'zh';
const formatDate = (value: string | null, locale: Locale) => value ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';

function targetStatus(target: import('./types').WatchTarget, text: typeof watchText.ja | typeof watchText.zh, locale: Locale, checkingTimedOut = false) {
  if (!target.enabled) return { tone: 'paused', label: text.paused, detail: '' };
  if (target.status === 'checking' && checkingTimedOut) return { tone: 'checking', label: text.checkingTimeout, detail: '' };
  if (target.status === 'checking') return { tone: 'checking', label: text.checking, detail: target.last_success_at ? `${text.lastSuccess} ${formatDate(target.last_success_at, locale)}` : '' };
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

export function CompanyWatchSection({ company, locale, openSettings, highlightEventId }: { company: { id: string; name: string }; locale: Locale; openSettings(): void; highlightEventId?: string }) {
  const text = watchText[locale], watch = useWatch();
  const [formOpen, setFormOpen] = useState(false), [editingId, setEditingId] = useState<string | null>(null), [sourceType, setSourceType] = useState<WatchSource>('official'), [url, setUrl] = useState(''), [label, setLabel] = useState(''), [message, setMessage] = useState(''), [notice, setNotice] = useState(''), [noticeTargetId, setNoticeTargetId] = useState<string | null>(null), [actionsFor, setActionsFor] = useState<string | null>(null);
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
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage('');
    try {
      const response = await watch.request(editingId ? `/api/targets/${editingId}` : '/api/targets', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify({ companyId: company.id, companyName: company.name, sourceType, url, label }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(body.error === 'DUPLICATE_URL' ? text.duplicate : text.invalid); return; }
      const submittedTargetId = typeof body.id === 'string' ? body.id : null;
      const checking = body.status === 'checking';
      if (!editingId && checking && submittedTargetId) watch.trackCheck(submittedTargetId);
      setNotice(editingId ? '' : body.status === 'paused' ? text.duplicatePaused : checking ? body.duplicate ? text.duplicateChecking : text.addedChecking : '');
      setNoticeTargetId(!editingId && checking ? submittedTargetId : null);
      setFormOpen(false); setEditingId(null); setUrl(''); setLabel(''); await watch.refresh();
    } catch { setMessage(text.unavailable); }
  };
  const changeEnabled = async (target: import('./types').WatchTarget) => {
    const response = await watch.request(`/api/targets/${target.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !target.enabled }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.status === 'checking') watch.trackCheck(target.id);
    await watch.refresh();
    setActionsFor(null);
  };
  const remove = async (target: import('./types').WatchTarget) => { await watch.request(`/api/targets/${target.id}`, { method: 'DELETE' }); await watch.refresh(); setActionsFor(null); };
  const edit = (target: import('./types').WatchTarget) => { setEditingId(target.id); setSourceType(target.source_type); setUrl(target.url); setLabel(target.label); setFormOpen(true); setActionsFor(null); };
  const actionTarget = targets.find((target) => target.id === actionsFor);
  return <section id="company-watch" className="company-watch-section detail-section">
    <div className="company-watch-heading"><h2>{text.title}</h2>{watch.authenticated && <button type="button" className="text-button" onClick={() => { setEditingId(null); setSourceType('official'); setUrl(''); setLabel(''); setMessage(''); setNotice(''); setFormOpen(true); }}><Plus />{text.add}</button>}</div>
    {notice && <p className="company-watch-notice" role="status">{notice}</p>}
    {!watch.configured ? <p className="company-watch-muted">{text.unavailable}</p> : !watch.authenticated ? <div className="company-watch-connect"><p>{text.notConnected}</p><button type="button" className="text-button" onClick={openSettings}>{text.settings}<ExternalLink /></button></div> : targets.length ? <div className="watch-target-list">{targets.map((target) => {
      const status = targetStatus(target, text, locale, watch.checkingTimedOut.includes(target.id));
      return <article className="watch-target-item" key={target.id}>
      <div className="watch-target-copy"><strong>{target.label || text[target.source_type]}</strong><a href={target.url} target="_blank" rel="noreferrer" title={target.url}>{new URL(target.url).host}{new URL(target.url).pathname}<ExternalLink /></a><small className={`watch-status ${status.tone}`}>{status.label}{status.detail ? ` · ${status.detail}` : ''}</small>{target.last_error && <small title={target.last_error}>{targetErrorText(target.last_error, text)}</small>}</div>
      <div className="watch-target-actions">
        <button className="watch-target-actions-more" title={locale === 'ja' ? '操作' : '操作'} onClick={() => setActionsFor(target.id)}><MoreHorizontal /></button>
        <div className="watch-target-actions-desktop"><button title={text.edit} onClick={() => edit(target)}><Pencil /></button>
        {target.status === 'error' && <button title={text.retry} onClick={async () => { const response = await watch.request(`/api/targets/${target.id}/retry`, { method: 'POST' }); const body = await response.json().catch(() => ({})); if (response.ok && body.status === 'checking') watch.trackCheck(target.id); await watch.refresh(); }}><RefreshCw /></button>}
        <button title={target.enabled ? text.pause : text.resume} onClick={() => void changeEnabled(target)}>{target.enabled ? <Pause /> : <Play />}</button>
        <button title={text.remove} className="danger-icon" onClick={() => void remove(target)}><Trash2 /></button></div>
      </div>
    </article>; })}</div> : <div className="company-watch-empty"><Eye /><p>{text.empty}</p><button type="button" onClick={() => setFormOpen(true)}><Plus />{text.add}</button></div>}
    {formOpen && <div className="modal-layer watch-dialog-layer"><button className="modal-backdrop" aria-label={text.cancel} onClick={() => setFormOpen(false)} /><section className="drawer entity-card watch-dialog" role="dialog" aria-modal="true"><header><h2>{text.add}</h2><button className="close-button" onClick={() => setFormOpen(false)} aria-label={text.cancel}><X /></button></header><form onSubmit={submit}><div className="form-grid"><label>{text.source}<select value={sourceType} onChange={(e) => setSourceType(e.target.value as WatchSource)}><option value="mynavi">{text.mynavi}</option><option value="official">{text.official}</option><option value="other">{text.other}</option></select></label><label>{text.url}<input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label><label>{text.label}<input value={label} onChange={(e) => setLabel(e.target.value)} /></label></div>{message && <p className="form-error">{message}</p>}<footer className="form-actions"><button type="button" onClick={() => setFormOpen(false)}>{text.cancel}</button><button className="primary" type="submit">{text.save}</button></footer></form></section></div>}
    {updates.length > 0 && <div className="company-watch-updates"><h3>{text.updates}</h3>{updates.map((event) => <article id={`company-watch-update-${event.id}`} className="company-watch-update" key={event.id}><div><strong>{event.title}</strong><p>{event.summary}</p></div><time>{formatDate(event.detected_at, locale)}</time></article>)}</div>}
    {actionTarget && createPortal(<div className="action-sheet-layer watch-target-action-layer"><button className="action-sheet-backdrop" aria-label={text.cancel} onClick={() => setActionsFor(null)} /><section className="action-sheet watch-target-action-sheet" role="dialog" aria-modal="true"><button type="button" onClick={() => edit(actionTarget)}>{text.edit}</button><button type="button" onClick={() => void changeEnabled(actionTarget)}>{actionTarget.enabled ? text.pause : text.resume}</button><button type="button" className="danger" onClick={() => void remove(actionTarget)}>{text.remove}</button><button type="button" className="cancel-action" onClick={() => setActionsFor(null)}>{text.cancel}</button></section></div>, document.body)}
  </section>;
}

function WatchLogin({ locale }: { locale: Locale }) { const text = watchText[locale], watch = useWatch(), [code, setCode] = useState(''), [error, setError] = useState(''); return <form className="watch-login" onSubmit={async (event) => { event.preventDefault(); try { await watch.connect(code); setCode(''); } catch { setError('AUTH_FAILED'); } }}><label>{text.code}<input type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} /></label><button className="primary">{text.connect}</button>{error && <small>{error}</small>}</form>; }

export function WatchConnectionSettings({ locale }: { locale: Locale }) {
  const text = watchText[locale], watch = useWatch();
  if (!watch.configured) return <section className="watch-connection-settings"><h3>{text.connection}</h3><p>{text.unavailable}</p></section>;
  return <section className="watch-connection-settings"><h3>{text.connection}</h3>{watch.authenticated ? <><p>{text.connected}</p><button type="button" onClick={watch.disconnect}>{text.disconnect}</button></> : <><p>{text.connectFromSettings}</p><WatchLogin locale={locale} /></>}</section>;
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
          <button type="button" className={`notification-page-row${item.read ? ' is-read' : ''}${productUpdate ? ' has-product-brand' : ''}`} aria-expanded={expanded} onClick={() => void choose(item)}>{productUpdate ? <span className="notification-page-brand" aria-hidden="true"><YamiBrandAvatar alt="" />{!item.read && <span className="notification-page-dot" />}</span> : !item.read && <span className="notification-page-dot" aria-hidden="true" />}<span className="notification-page-copy">{productUpdate ? <strong className="notification-page-product-title"><YamiWordmark label="Yami" /><span>{item.title.replace(/^Yami/, '')}</span></strong> : <><strong>{item.companyName}</strong><b>{item.title}</b></>}<small>{item.summary}</small></span><time>{formatDate(item.detectedAt, locale)}</time></button>
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
  return <span className={`company-watch-card-status${unread ? ' has-updates' : ''}`}>
    {!unread && status?.tone === 'active' && <span className="company-watch-active-dot" aria-hidden="true" />}
    {unread ? `● ${unread}${locale === 'ja' ? '件の更新' : ' 条更新'}` : status?.label}
  </span>;
}
