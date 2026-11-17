/**
 * Copy text to the clipboard. Uses the async Clipboard API, falling back to a
 * hidden textarea + execCommand where that API is missing (plain-http pages on
 * a LAN address, older in-app browsers).
 *
 * @param {string} text
 * @returns {Promise<boolean>} whether the copy worked
 */
export const copyText = async (text) => {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea fallback
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
};
