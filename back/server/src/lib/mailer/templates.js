/**
 * Email templates. Each builder returns { subject, html, text } for sendMail().
 * Kept intentionally simple (inline styles, no external assets) so they render
 * in any client and need no build step.
 */

const APP_NAME = process.env.APP_NAME || "Template";

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
 * email per run of the venue-alerts job. Sent only when SMTP is set up.
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
