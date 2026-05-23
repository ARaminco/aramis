// Robust clipboard copy: tries the async Clipboard API first, falls back to a
// hidden textarea + execCommand('copy') for older browsers / non-secure
// contexts. Returns a Promise<boolean>.
export async function copyToClipboard(text) {
  if (text == null) return false;
  const str = typeof text === 'string' ? text : String(text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(str);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}
