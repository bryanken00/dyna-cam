/**
 * Copy text to the clipboard. Uses the async Clipboard API, falling back to a
 * hidden textarea + execCommand where that API is missing (plain-http pages on
 * a LAN address, older in-app browsers). The fallback's textarea goes inside
 * the dialog that holds focus, so it works from drawers and modals too (BUG-009).
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
  // BUG-009: inside an open dialog or drawer (Radix), focus is trapped in it —
  // a textarea on <body> can't take focus or a selection there, so nothing is
  // copied. Put it inside the dialog that holds focus, and hand focus back after.
  const previous = document.activeElement;
  const host = previous?.closest?.('[role="dialog"], [role="alertdialog"]') || document.body;
  const el = document.createElement("textarea");
  try {
    el.value = text;
    el.setAttribute("readonly", "");
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    Object.assign(el.style, { position: "fixed", top: "0", left: "0", width: "1px", height: "1px", opacity: "0" });
    host.appendChild(el);
    el.focus({ preventScroll: true });
    el.select();
    el.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    el.remove();
    if (previous && typeof previous.focus === "function") previous.focus({ preventScroll: true });
  }
};
