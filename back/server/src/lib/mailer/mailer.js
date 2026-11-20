import { logger } from "../../../config/logger.js";

/**
 * Email transport — env-gated (CR-018: SendGrid only, SMTP removed):
 *
 *  1. SENDGRID_API_KEY set → SendGrid's Web API v3 (`POST /v3/mail/send`,
 *     plain `fetch`, no SDK). Every email goes this way: password resets, venue
 *     alerts, the player's Google Drive link. MAIL_FROM must be a sender
 *     verified in SendGrid. SENDGRID_API_URL overrides the host (tests).
 *  2. No key → nothing is sent: the email is written to the log instead, so
 *     reset links etc. can be read in development.
 *
 * Env:
 *   SENDGRID_API_KEY, SENDGRID_API_URL
 *   MAIL_FROM   e.g.  "Dyna Cam <no-reply@dynacam.ph>"
 */

const DEFAULT_FROM = process.env.MAIL_FROM || "Template <no-reply@template.test>";

const SENDGRID_TIMEOUT_MS = 30 * 1000;

/** True when emails go through SendGrid (CR-018). */
export const sendgridConfigured = () => Boolean(process.env.SENDGRID_API_KEY);

/** "Dyna Cam <no-reply@x.ph>" → { name, email }; a bare address → { email }. */
const parseAddress = (value) => {
  const text = String(value || "").trim();
  const match = text.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].trim();
    return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
  }
  return { email: text };
};

/** `to` as SendGrid recipients: an address, a comma list, or an array of either. */
const recipients = (to) =>
  (Array.isArray(to) ? to : String(to || "").split(","))
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseAddress);

/**
 * Send one email through SendGrid's Web API. Resolves with SendGrid's message
 * id; throws with SendGrid's reason on any refusal (bad key, unverified
 * sender, …). The API key is never logged.
 */
const sendViaSendgrid = async ({ to, subject, html, text }) => {
  const base = (process.env.SENDGRID_API_URL || "https://api.sendgrid.com").replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(`${base}/v3/mail/send`, {
      method: "POST",
      signal: AbortSignal.timeout(SENDGRID_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: recipients(to) }],
        from: parseAddress(process.env.MAIL_FROM || DEFAULT_FROM),
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach SendGrid (${err.name === "TimeoutError" ? "timed out" : err.message})`
    );
  }
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.errors?.[0]?.message) reason = body.errors[0].message;
    } catch {
      // not JSON — keep the status
    }
    const error = new Error(`SendGrid refused the email: ${reason}`.slice(0, 250));
    error.status = res.status;
    throw error;
  }
  return res.headers.get("x-message-id") || null;
};

/**
 * Send an email. Never throws to the caller by default — a failed email must
 * not break the request flow (e.g. forgot-password stays a 200). Pass
 * `{ throwOnError: true }` if a caller needs to know.
 *
 * @param {Object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text]
 * @param {boolean} [opts.throwOnError=false]
 * @returns {Promise<{ sent: boolean }>}
 */
export const sendMail = async ({ to, subject, html, text, throwOnError = false }) => {
  const plain = text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  try {
    if (sendgridConfigured()) {
      const messageId = await sendViaSendgrid({ to, subject, html, text: plain });
      logger.info("Email sent (SendGrid)", { to, subject, messageId });
      return { sent: true };
    }

    // Development: surface the full message (incl. any links) in the logs
    logger.info("Email (no SENDGRID_API_KEY — logged, not sent)", {
      to,
      subject,
      from: process.env.MAIL_FROM || DEFAULT_FROM,
      text: plain,
    });
    return { sent: true };
  } catch (error) {
    logger.error("Failed to send email", { to, subject, error: error.message });
    if (throwOnError) throw error;
    return { sent: false };
  }
};

export default { sendMail };
