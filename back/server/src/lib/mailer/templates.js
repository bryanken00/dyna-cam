/**
 * Email templates. Each builder returns { subject, html, text } for sendMail().
 * Kept intentionally simple (inline styles, no external assets) so they render
 * in any client and need no build step.
 */

const APP_NAME = process.env.APP_NAME || "DGSports";

const layout = (title, bodyHtml) => `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #18181b;">
    <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">${title}</h1>
    ${bodyHtml}
    <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 28px 0 16px;" />
    <p style="font-size: 12px; color: #a1a1aa; margin: 0;">${APP_NAME} · This is an automated message, please do not reply.</p>
  </div>
`;

const button = (href, label) => `
  <a href="${href}" style="display: inline-block; background: #18181b; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 11px 20px; border-radius: 8px;">${label}</a>
`;

/**
 * Password reset email.
 * @param {{ name?: string, resetUrl: string, expiresMinutes: number }} p
 */
export const passwordResetEmail = ({ name, resetUrl, expiresMinutes }) => ({
  subject: `Reset your ${APP_NAME} password`,
  html: layout(
    "Reset your password",
    `
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
      ${name ? `Hi ${name},` : "Hi,"} we received a request to reset your password.
      Click the button below to choose a new one. This link expires in
      ${expiresMinutes} minutes.
    </p>
    <p style="margin: 0 0 20px;">${button(resetUrl, "Reset password")}</p>
    <p style="font-size: 13px; color: #71717a; line-height: 1.6; margin: 0;">
      If you didn't request this, you can safely ignore this email — your password
      won't change. If the button doesn't work, copy this link into your browser:<br />
      <span style="color: #16a34a; word-break: break-all;">${resetUrl}</span>
    </p>
  `
  ),
});

/**
 * Email-verification email (template ready for a future verify-email flow).
 * @param {{ name?: string, verifyUrl: string, expiresMinutes: number }} p
 */
export const verifyEmail = ({ name, verifyUrl, expiresMinutes }) => ({
  subject: `Verify your ${APP_NAME} email`,
  html: layout(
    "Verify your email",
    `
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
      ${name ? `Hi ${name},` : "Hi,"} confirm your email address to finish setting
      up your account. This link expires in ${expiresMinutes} minutes.
    </p>
    <p style="margin: 0 0 20px;">${button(verifyUrl, "Verify email")}</p>
    <p style="font-size: 13px; color: #71717a; word-break: break-all; margin: 0;">${verifyUrl}</p>
  `
  ),
});

/**
 * Team-invite email (template ready for a future invite flow).
 * @param {{ inviterName?: string, inviteUrl: string, companyName?: string }} p
 */
export const inviteEmail = ({ inviterName, inviteUrl, companyName }) => ({
  subject: `You've been invited to ${companyName || APP_NAME}`,
  html: layout(
    "You've been invited",
    `
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
      ${inviterName ? `${inviterName} has` : "You've been"} invited you to join
      ${companyName ? `<strong>${companyName}</strong>` : APP_NAME}. Click below to
      accept and set up your account.
    </p>
    <p style="margin: 0 0 20px;">${button(inviteUrl, "Accept invite")}</p>
    <p style="font-size: 13px; color: #71717a; word-break: break-all; margin: 0;">${inviteUrl}</p>
  `
  ),
});

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );

/**
 * CR-008: venue problems that just opened and ones that just cleared, in one
 * email per run of the venue-alerts job. Sent only when SendGrid is set up.
 *
 * @param {{ opened: object[], resolved: object[], dashboardUrl: string }} p
 *   each item: { label, venueName, message, since }
 */
export const venueAlertsEmail = ({ opened, resolved, dashboardUrl }) => {
  const venues = [...new Set([...opened, ...resolved].map((a) => a.venueName))];
  const where = venues.length === 1 ? ` at ${venues[0]}` : "";
  const subject =
    opened.length > 0
      ? `${opened.length === 1 ? opened[0].label : `${opened.length} problems`}${where}`
      : `All clear${where}`;

  const rows = (items, colour) =>
    items
      .map(
        (a) => `
      <li style="margin: 0 0 12px;">
        <strong style="color: ${colour};">${escapeHtml(a.label)}</strong> · ${escapeHtml(a.venueName)}<br />
        <span style="font-size: 13px; color: #3f3f46;">${escapeHtml(a.message)}</span><br />
        <span style="font-size: 12px; color: #71717a;">${escapeHtml(a.since)}</span>
      </li>`
      )
      .join("");

  const section = (title, items, colour) =>
    items.length === 0
      ? ""
      : `<p style="font-size: 14px; font-weight: 600; margin: 0 0 8px;">${title}</p>
         <ul style="font-size: 14px; line-height: 1.5; margin: 0 0 20px; padding-left: 18px;">${rows(items, colour)}</ul>`;

  return {
    subject: `${APP_NAME}: ${subject}`,
    html: layout(
      opened.length > 0 ? "Something needs attention" : "All clear",
      `
      ${section("New problems", opened, "#dc2626")}
      ${section("Fixed", resolved, "#16a34a")}
      ${dashboardUrl ? `<p style="margin: 0;">${button(dashboardUrl, "Open the Dashboard")}</p>` : ""}
      `
    ),
  };
};

/**
 * CR-018: "Your game is in Google Drive" — sent to the player's email once the
 * game's videos are in the court's Drive and the game is paid (or free).
 *
 * @param {{ playerName?: string, courtName: string, venueName: string,
 *           playedOn: string, driveUrl: string, keepUntil?: string|null }} p
 *   playedOn / keepUntil: already formatted ("Nov 20, 2026, 3:00 PM")
 */
export const gameDriveEmail = ({ playerName, courtName, venueName, playedOn, driveUrl, keepUntil }) => {
  const where = `${escapeHtml(courtName)} · ${escapeHtml(venueName)}`;
  const href = escapeHtml(driveUrl);
  return {
    subject: `Your game at ${venueName} is ready in Google Drive`,
    html: layout(
      "Your game is ready",
      `
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
      ${playerName ? `Hi ${escapeHtml(playerName)},` : "Hi,"} the videos of your game are in
      Google Drive — open them on any phone or computer, no Google account needed.
    </p>
    <p style="font-size: 13px; color: #71717a; line-height: 1.6; margin: 0 0 20px;">
      ${where}<br />${escapeHtml(playedOn)}
    </p>
    <p style="margin: 0 0 20px;">${button(href, "Open your game in Google Drive")}</p>
    <p style="font-size: 13px; color: #71717a; line-height: 1.6; margin: 0;">
      ${
        keepUntil
          ? `Download your videos before <strong>${escapeHtml(keepUntil)}</strong> — they are deleted after that.`
          : "Download your videos soon — they are only kept for a short time."
      }
      If the button doesn't work, copy this link into your browser:<br />
      <span style="color: #2563eb; word-break: break-all;">${href}</span>
    </p>
  `
    ),
  };
};


// ── PLAN-003 Phase G: court bookings ─────────────────────────────────────────
//
// Every booking email shares one block: where and when, and the player's own
// booking page (CR-045: no booking code — the camera starts from that page). Times arrive already formatted (venue time).
// Built by utils/bookingEmails.js, which decides when each one is sent.

/**
 * @typedef {Object} BookingEmailFacts
 * @property {string|null} playerName
 * @property {string} venueName
 * @property {string} courtName
 * @property {string} day - "Tue, Nov 24, 2026"
 * @property {string} time - "5:00 PM – 7:00 PM"
 * @property {string} price - "₱800"
 * @property {string} manageUrl - the player's booking page
 */

const p = (html, extra = "") =>
  `<p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px;${extra}">${html}</p>`;
const muted = (html) =>
  `<p style="font-size: 13px; color: #71717a; line-height: 1.6; margin: 0 0 16px;">${html}</p>`;
const hi = (name) => (name ? `Hi ${escapeHtml(name)},` : "Hi,");

/** Where and when — the part every booking email repeats. */
const bookingFacts = (b) => `
  <table role="presentation" style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 0 0 20px; border: 1px solid #e4e4e7; border-radius: 8px;">
    <tr><td style="padding: 10px 14px; color: #71717a;">Where</td>
        <td style="padding: 10px 14px; text-align: right;">${escapeHtml(b.courtName)} · ${escapeHtml(b.venueName)}</td></tr>
    <tr><td style="padding: 10px 14px; color: #71717a; border-top: 1px solid #e4e4e7;">When</td>
        <td style="padding: 10px 14px; text-align: right; border-top: 1px solid #e4e4e7;">${escapeHtml(b.day)}<br />${escapeHtml(b.time)}</td></tr>
  </table>`;

const manageLink = (b, label = "Open your booking") => `
  <p style="margin: 0 0 20px;">${button(escapeHtml(b.manageUrl), label)}</p>
  ${muted(`If the button doesn't work, copy this link into your browser:<br />
    <span style="color: #2563eb; word-break: break-all;">${escapeHtml(b.manageUrl)}</span>`)}`;

/** CR-045: the camera starts from the booking's own page — no QR sign, no code. */
const howToRecord = (b, checkInFrom) =>
  muted(`At the court${
    checkInFrom ? ` from ${escapeHtml(checkInFrom)}` : ""
  }, open your booking (the button below) and tap <strong>I'm at the court — start recording</strong>. ${escapeHtml(
    b.courtName
  )}'s camera records your game for your booked time, and you get the video on your phone.`);

/**
 * Booking confirmed (paid or free).
 * @param {BookingEmailFacts & { paidLine: string, checkInFrom?: string }} b
 *   paidLine: "Paid ₱800 online" · "Paid ₱800 at the desk" · "Free"
 */
export const bookingConfirmedEmail = (b) => ({
  subject: `Booked: ${b.courtName} at ${b.venueName}, ${b.day}`,
  html: layout(
    "You're booked",
    `${p(`${hi(b.playerName)} your court is booked. ${escapeHtml(b.paidLine)}.`)}
     ${bookingFacts(b)}
     ${howToRecord(b, b.checkInFrom)}
     ${manageLink(b)}`
  ),
});

/**
 * Held, waiting for payment at the desk.
 * @param {BookingEmailFacts & { payBy: string, payOnline?: boolean }} b
 *   payBy: "4:30 PM, Tue Nov 24"
 */
export const bookingPayAtDeskEmail = (b) => ({
  subject: `Pay by ${b.payBy} to keep your court — ${b.venueName}`,
  html: layout(
    "Pay to confirm your booking",
    `${p(`${hi(b.playerName)} we're holding ${escapeHtml(b.courtName)} for you. Pay
       <strong>${escapeHtml(b.price)}</strong> at the front desk${b.payOnline ? " (or online from your booking page)" : ""}
       by <strong>${escapeHtml(b.payBy)}</strong> — after that the court is released.`)}
     ${bookingFacts(b)}
     ${muted("Give your name at the desk when you pay.")}
     ${manageLink(b)}`
  ),
});

/**
 * Reminder, a couple of hours before.
 * @param {BookingEmailFacts & { startsIn: string, checkInFrom?: string }} b
 *   startsIn: "in 2 hours"
 */
export const bookingReminderEmail = (b) => ({
  subject: `Reminder: ${b.courtName} at ${b.venueName}, ${b.time}`,
  html: layout(
    "See you on the court",
    `${p(`${hi(b.playerName)} your booking starts ${escapeHtml(b.startsIn)}.`)}
     ${bookingFacts(b)}
     ${howToRecord(b, b.checkInFrom)}
     ${manageLink(b)}`
  ),
});

/**
 * Cancelled (by the venue, a closure, the player) or released unpaid.
 * @param {BookingEmailFacts & { title: string, why: string, refundLines: string[] }} b
 *   why: a sentence; refundLines: what happens to the money (may be empty)
 */
export const bookingCancelledEmail = (b) => ({
  subject: `${b.title} — ${b.courtName}, ${b.day}`,
  html: layout(
    b.title,
    `${p(`${hi(b.playerName)} ${escapeHtml(b.why)}`)}
     ${bookingFacts(b)}
     ${b.refundLines.map((line) => p(escapeHtml(line))).join("")}
     ${muted("Questions? Contact the venue. You're welcome to book another time.")}`
  ),
});

/**
 * Moved to another time and/or court.
 * @param {BookingEmailFacts & { previous: string }} b - previous: "Court 1 · Tue, Nov 24, 5:00 PM – 6:00 PM"
 */
export const bookingMovedEmail = (b) => ({
  subject: `Booking moved: ${b.courtName}, ${b.day} ${b.time}`,
  html: layout(
    "Your booking was moved",
    `${p(`${hi(b.playerName)} your booking has a new time. It was ${escapeHtml(b.previous)}.`)}
     ${bookingFacts(b)}
     ${manageLink(b)}`
  ),
});

/**
 * Checked in: the game page.
 * @param {BookingEmailFacts & { gameUrl: string, recordingFrom: string }} b
 *   recordingFrom: "now" · "at 5:00 PM"
 */
export const bookingGameStartedEmail = (b) => ({
  subject: `Your game at ${b.venueName} is recording`,
  html: layout(
    "You're checked in",
    `${p(`${hi(b.playerName)} the camera on ${escapeHtml(b.courtName)} records your game ${escapeHtml(
      b.recordingFrom
    )} until ${escapeHtml(b.time.split("–").pop().trim())}. Watch it live, save your best rallies
       and get the whole game from your game page.`)}
     <p style="margin: 0 0 20px;">${button(escapeHtml(b.gameUrl), "Open your game")}</p>
     ${muted(`If the button doesn't work, copy this link into your browser:<br />
       <span style="color: #2563eb; word-break: break-all;">${escapeHtml(b.gameUrl)}</span>`)}`
  ),
});

/**
 * An online payment the booking couldn't keep (paid after the slot was lost,
 * paid twice, …) — it's being given back.
 * @param {BookingEmailFacts & { why: string, refundLine: string }} b
 */
export const bookingPaymentRefundedEmail = (b) => ({
  subject: `Your payment to ${b.venueName} is being refunded`,
  html: layout(
    "We're refunding your payment",
    `${p(`${hi(b.playerName)} ${escapeHtml(b.why)}`)}
     ${bookingFacts(b)}
     ${p(escapeHtml(b.refundLine))}
     ${manageLink(b, "Open your booking")}`
  ),
});
