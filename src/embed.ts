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
