import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WatchEvent, WatchTarget } from './types';
export { companyWatchKey } from './companyStatus';

const API = (import.meta.env.VITE_WATCH_API_URL as string | undefined)?.replace(/\/$/, '');
const TOKEN_KEY = 'careerflow-watch-session';
type ContextValue = { configured: boolean; authenticated: boolean; targets: WatchTarget[]; events: WatchEvent[]; now: number; checkingTimedOut: string[]; error: string; connect(code: string): Promise<void>; disconnect(): void; refresh(): Promise<void>; request(path: string, init?: RequestInit): Promise<Response>; trackCheck(id: string): void; markRead(id: string): Promise<void>; markAllRead(): Promise<void>; };
const Context = createContext<ContextValue | null>(null);

export function WatchProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '');
  const [targets, setTargets] = useState<WatchTarget[]>([]);
  const [events, setEvents] = useState<WatchEvent[]>([]);
  const [now, setNow] = useState(Date.now);
  const [checkingTimedOut, setCheckingTimedOut] = useState<string[]>([]);
  const [error, setError] = useState('');
  const checkingStartedAt = useRef(new Map<string, number>());
  const [checkGeneration, setCheckGeneration] = useState(0);
  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!API) throw new Error('NOT_CONFIGURED');
    const response = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    if (response.status === 401 && path !== '/api/session') {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      setToken('');
    }
    return response;
  }, [token]);
  const refresh = useCallback(async () => {
    if (!API || !token) return;
    const response = await request('/api/targets');
    if (!response.ok) { setError((await response.json().catch(() => ({}))).error || 'LOAD_FAILED'); return; }
    const body = await response.json(); setTargets(body.targets || []); setEvents(body.events || []); setError('');
  }, [request, token]);
  const trackCheck = useCallback((id: string) => {
    checkingStartedAt.current.set(id, Date.now());
    setCheckingTimedOut((current) => current.filter((targetId) => targetId !== id));
    setCheckGeneration((generation) => generation + 1);
  }, []);
  useEffect(() => {
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
        void refresh().catch(() => setError('LOAD_FAILED'));
      }
    };

    syncWhenVisible();
    const timer = API && token ? window.setInterval(syncWhenVisible, 60_000) : undefined;
    document.addEventListener('visibilitychange', syncWhenVisible);
    window.addEventListener('pageshow', syncWhenVisible);
    return () => {
      document.removeEventListener('visibilitychange', syncWhenVisible);
      window.removeEventListener('pageshow', syncWhenVisible);
      window.clearInterval(timer);
    };
  }, [refresh, token]);
  const checkingTargetsKey = targets
    .filter((target) => target.enabled && target.status === 'checking')
    .map((target) => target.id)
    .join('|');
  useEffect(() => {
    const checkingIds = checkingTargetsKey ? checkingTargetsKey.split('|') : [];
    const checkingSet = new Set(checkingIds);
    for (const id of checkingStartedAt.current.keys()) {
      if (!checkingSet.has(id)) checkingStartedAt.current.delete(id);
    }
    for (const id of checkingIds) {
      if (!checkingStartedAt.current.has(id)) checkingStartedAt.current.set(id, Date.now());
    }
    setCheckingTimedOut((current) => current.filter((id) => checkingSet.has(id)));
    if (!token || !checkingIds.length) return;
    let cancelled = false;
    let timer = 0;
    let attempts = 0;
    const scheduleRefresh = () => {
      if (cancelled) return;
      const now = Date.now();
      const pendingIds = checkingIds.filter((id) => now - (checkingStartedAt.current.get(id) || now) < 60_000);
      const timedOutIds = checkingIds.filter((id) => !pendingIds.includes(id));
      if (timedOutIds.length) {
        setCheckingTimedOut((current) => [...new Set([...current, ...timedOutIds])]);
      }
      if (!pendingIds.length) return;
      const delay = Math.min(2500 + attempts * 500, 5000);
      timer = window.setTimeout(async () => {
        try {
          if (document.visibilityState === 'visible') await refresh();
        } catch {
          setError('LOAD_FAILED');
        } finally {
          attempts += 1;
          scheduleRefresh();
        }
      }, delay);
    };
    scheduleRefresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token, checkingTargetsKey, refresh, checkGeneration]);
  useEffect(() => {
    if (!token) return;
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
  }, [token]);
  const connect = async (code: string) => {
    if (!API) throw new Error('NOT_CONFIGURED');
    const response = await fetch(`${API}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.trim() }) });
    if (!response.ok) throw new Error('AUTH_FAILED');
    const body = await response.json(); localStorage.setItem(TOKEN_KEY, body.token); sessionStorage.removeItem(TOKEN_KEY); setToken(body.token);
  };
  const disconnect = () => {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setTargets([]);
    setEvents([]);
  };
  const markRead = async (id: string) => {
    setEvents((current) => current.map((event) => event.id === id ? { ...event, read: 1 } : event));
    const response = await request(`/api/events/${id}/read`, { method: 'POST' });
    if (!response.ok) void refresh();
  };
  const markAllRead = async () => { await request('/api/events/read-all', { method: 'POST' }); setEvents((current) => current.map((event) => ({ ...event, read: 1 }))); };
  const value = useMemo(() => ({ configured: Boolean(API), authenticated: Boolean(token), targets, events, now, checkingTimedOut, error, connect, disconnect, refresh, request, trackCheck, markRead, markAllRead }), [token, targets, events, now, checkingTimedOut, error, request, refresh, trackCheck]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWatch() { const value = useContext(Context); if (!value) throw new Error('WatchProvider missing'); return value; }
