/**
 * Embed mode: Yami shown inside another app's window (currently only Argon, the
 * owner's macOS workspace app). The host marks the page before it loads, with
 * `<html data-embed="argon">` or `?embed=argon`. In embed mode the page draws no
 * background of its own (the host's window shows through), uses a compact top
 * navigation instead of the sidebar, and follows the host's light/dark
 * appearance. The regular web version is unchanged.
 *
 * Argon also writes its look onto <html> for styling (see embed.css):
 * data-argon-scheme (light|dark), data-argon-material (automatic|classic|clear),
 * data-argon-content-opacity (0.30–0.95), data-argon-clear-text-tone.
 */
export type EmbedHost = 'argon';

function detectEmbedHost(): EmbedHost | null {
  if (typeof document === 'undefined') return null;
  const root = document.documentElement;
  if (new URLSearchParams(window.location.search).get('embed') === 'argon') root.dataset.embed = 'argon';
  return root.dataset.embed === 'argon' ? 'argon' : null;
}

export const EMBED_HOST: EmbedHost | null = detectEmbedHost();
export const isArgonEmbed = EMBED_HOST === 'argon';

/** Pages the host can show, in the order of the host's navigation (Argon's sidebar). */
export const EMBED_PAGES = ['dashboard', 'companies', 'notifications', 'schedule', 'materials', 'settings'] as const;
export type EmbedPage = typeof EMBED_PAGES[number];

type MenuOptionItem = {
  id: string;
  value: string;
  label: string;
  disabled: boolean;
  selected: boolean;
  symbol?: string;
};

type HostMessage =
  | { type: 'state'; page: EmbedPage; unread: number; canGoBack?: boolean }
  | { type: 'modal'; rect: { x: number; y: number; width: number; height: number; radius: number } | null }
  | { type: 'openMenu'; id: string; rect: { x: number; y: number; width: number; height: number }; align?: 'start' | 'end'; items: MenuOptionItem[] }
  | { type: 'closeMenu' };

type SwipeHandler = {
  onMove: (dx: number) => void;
  onEnd: (velocity: number) => void;
};

let swipeHandler: SwipeHandler | null = null;
let activeMenuSeq = 0;
const pendingMenus = new Map<string, { onPick: (value: string) => void; onCancel: () => void }>();

export function registerEmbedSwipeHandler(handler: SwipeHandler | null): void {
  swipeHandler = handler;
}

export function usesArgonNativeMenus(): boolean {
  return isArgonEmbed && typeof document !== 'undefined' && document.documentElement.dataset.argonNativeMenus === 'true';
}

export function openEmbedActionMenu(
  anchor: HTMLElement,
  items: Array<{ id: string; label: string; symbol?: string; choose: () => void }>,
  onCancel: () => void,
  align: 'start' | 'end' = 'end'
): void {
  const id = `menu-${++activeMenuSeq}`;
  const map = new Map(items.map((item) => [item.id, item]));
  pendingMenus.set(id, {
    onPick: (pickedId) => {
      const target = map.get(pickedId);
      if (target) target.choose();
      else onCancel();
    },
    onCancel,
  });
  const r = anchor.getBoundingClientRect();
  postToHost({
    type: 'openMenu',
    id,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    align,
    items: items.map((item) => ({
      id: item.id,
      value: item.id,
      label: item.label,
      disabled: false,
      selected: false,
      symbol: item.symbol,
    })),
  });
}

/** Page → host. Argon registers a WKScriptMessageHandler named "argon". */
export function postToHost(message: HostMessage): void {
  const handler = (window as unknown as { webkit?: { messageHandlers?: { argon?: { postMessage(m: unknown): void } } } })
    .webkit?.messageHandlers?.argon;
  handler?.postMessage(message);
}

/**
 * Host → page: `window.yamiEmbed.show("companies")`, trackpad swipe callbacks, and native menu callbacks.
 */
export function installEmbedNavigation(current: () => EmbedPage, go: (page: EmbedPage) => void): () => void {
  const show = (page: EmbedPage) => {
    if (!EMBED_PAGES.includes(page)) return;
    const from = current();
    if (page === from) return;
    const root = document.documentElement;
    const startViewTransition = (document as Document & { startViewTransition?: (update: () => void) => unknown }).startViewTransition;
    if (!startViewTransition) { go(page); return; }
    root.dataset.embedPush = EMBED_PAGES.indexOf(page) >= EMBED_PAGES.indexOf(from) ? 'down' : 'up';
    window.scrollTo(0, 0);
    const transition = startViewTransition.call(document, () => go(page)) as { finished?: Promise<unknown> } | undefined;
    transition?.finished?.finally(() => { delete root.dataset.embedPush; });
  };
  const swipeMove = (dx: number) => { swipeHandler?.onMove(dx); };
  const swipeEnd = (velocity: number) => { swipeHandler?.onEnd(velocity); };
  const _pickMenu = (id: string, value: string) => {
    const entry = pendingMenus.get(id);
    pendingMenus.delete(id);
    entry?.onPick(value);
  };
  const _closeMenu = (id: string) => {
    const entry = pendingMenus.get(id);
    pendingMenus.delete(id);
    entry?.onCancel();
  };
  (window as unknown as { yamiEmbed?: unknown }).yamiEmbed = { show, swipeMove, swipeEnd, _pickMenu, _closeMenu };

  // Intercept native <select> popups so Argon opens a real macOS 26 Liquid Glass menu instead.
  const openNativeSelect = (select: HTMLSelectElement) => {
    if (select.disabled) return;
    const id = `menu-${++activeMenuSeq}`;
    pendingMenus.set(id, {
      onPick: (value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(select, value);
        else select.value = value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      },
      onCancel: () => {},
    });
    const r = select.getBoundingClientRect();
    const items: MenuOptionItem[] = Array.from(select.options).map((opt, idx) => ({
      id: `${idx}:${opt.value}`,
      value: opt.value,
      label: opt.textContent || '',
      disabled: opt.disabled,
      selected: opt.selected,
    }));
    postToHost({
      type: 'openMenu',
      id,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      align: 'start',
      items,
    });
  };
  const onPointerDown = (event: MouseEvent) => {
    if (!usesArgonNativeMenus() || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target.closest('select') : null;
    if (!(target instanceof HTMLSelectElement) || target.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    target.focus();
    openNativeSelect(target);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!usesArgonNativeMenus()) return;
    if (![' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    openNativeSelect(target);
  };
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);

  // Sync open modal card rect to Argon for native .regularMaterial glass backing & full-window dim.
  const modalSelector = '.modal-layer .drawer, .backup-restore-dialog, .watch-disconnect-dialog, .template-delete-dialog, .stage-progression-warning-dialog, .company-filter-sheet';
  let lastSerialized = '';
  let lastMaskKey = '';
  let observedEl: HTMLElement | null = null;
  let resizeObs: ResizeObserver | null = null;
  const applyWorkspaceCutout = (hole: { x: number; y: number; width: number; height: number; radius: number } | null) => {
    const workspace = document.querySelector<HTMLElement>('.career-app > .workspace');
    if (!workspace) return;
    if (!hole || document.documentElement.dataset.argonNativeModal !== 'true') {
      if (lastMaskKey !== '') {
        lastMaskKey = '';
        workspace.style.webkitMaskImage = '';
        workspace.style.maskImage = '';
        workspace.style.webkitMaskRepeat = '';
        workspace.style.maskRepeat = '';
        workspace.style.webkitMaskSize = '';
        workspace.style.maskSize = '';
      }
      return;
    }
    const wr = workspace.getBoundingClientRect();
    const w = Math.max(1, Math.ceil(wr.width));
    const h = Math.max(1, Math.ceil(wr.height));
    const hx = Math.round((hole.x - wr.left) * 10) / 10;
    const hy = Math.round((hole.y - wr.top) * 10) / 10;
    const hw = Math.max(0, hole.width);
    const hh = Math.max(0, hole.height);
    const rad = Math.max(0, Math.min(hole.radius, hw / 2, hh / 2));
    const key = `${w}:${h}:${hx}:${hy}:${hw}:${hh}:${rad}`;
    if (key === lastMaskKey) return;
    lastMaskKey = key;
    // Use fill-rule="evenodd" instead of <mask id="..."> so WebKit alpha-masks directly from the data URI.
    const holePath = `M${hx + rad} ${hy}H${hx + hw - rad}A${rad} ${rad} 0 0 1 ${hx + hw} ${hy + rad}V${hy + hh - rad}A${rad} ${rad} 0 0 1 ${hx + hw - rad} ${hy + hh}H${hx + rad}A${rad} ${rad} 0 0 1 ${hx} ${hy + hh - rad}V${hy + rad}A${rad} ${rad} 0 0 1 ${hx + rad} ${hy}Z`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><path fill='black' fill-rule='evenodd' d='M0 0H${w}V${h}H0Z${holePath}'/></svg>`;
    const value = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    workspace.style.webkitMaskImage = value;
    workspace.style.maskImage = value;
    workspace.style.webkitMaskRepeat = 'no-repeat';
    workspace.style.maskRepeat = 'no-repeat';
    workspace.style.webkitMaskSize = `${w}px ${h}px`;
    workspace.style.maskSize = `${w}px ${h}px`;
  };
  const syncModalRect = () => {
    const el = document.querySelector<HTMLElement>(modalSelector);
    if (!el || el.closest('.is-closing')) {
      if (observedEl) {
        resizeObs?.disconnect();
        observedEl = null;
      }
      applyWorkspaceCutout(null);
      if (lastSerialized !== 'null') {
        lastSerialized = 'null';
        postToHost({ type: 'modal', rect: null });
      }
      return;
    }
    if (observedEl !== el) {
      resizeObs?.disconnect();
      observedEl = el;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(syncModalRect);
        resizeObs.observe(el);
      }
    }
    const r = el.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 18;
    const payload = { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10, radius };
    applyWorkspaceCutout(payload);
    const serialized = JSON.stringify(payload);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      postToHost({ type: 'modal', rect: payload });
    }
  };
  const mutationObs = typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => requestAnimationFrame(syncModalRect))
    : null;
  mutationObs?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', syncModalRect);
  window.addEventListener('scroll', syncModalRect, { passive: true });
  syncModalRect();

  return () => {
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    mutationObs?.disconnect();
    resizeObs?.disconnect();
    window.removeEventListener('resize', syncModalRect);
    window.removeEventListener('scroll', syncModalRect);
    applyWorkspaceCutout(null);
    delete (window as unknown as { yamiEmbed?: unknown }).yamiEmbed;
  };
}
