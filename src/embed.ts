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

type HostMessage = { type: 'state'; page: EmbedPage; unread: number };

/** Page → host. Argon registers a WKScriptMessageHandler named "argon". */
export function postToHost(message: HostMessage): void {
  const handler = (window as unknown as { webkit?: { messageHandlers?: { argon?: { postMessage(m: unknown): void } } } })
    .webkit?.messageHandlers?.argon;
  handler?.postMessage(message);
}

/**
 * Host → page: `window.yamiEmbed.show("companies")`. The switch is animated like
 * the host's own page push — going down its sidebar the new page comes up from
 * below, going up it comes down from above — with View Transitions where
 * available; Reduce Motion gets a short cross-fade.
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
  (window as unknown as { yamiEmbed?: { show: typeof show } }).yamiEmbed = { show };
  return () => { delete (window as unknown as { yamiEmbed?: unknown }).yamiEmbed; };
}
