import { logger } from "../../../config/logger.js";

/**
 * Discord webhook sender (CR-008 venue alerts).
 *
 * The webhook URL holds its own token, so it lives only in the API's .env
 * (ALERT_DISCORD_WEBHOOK_URL) and is never logged. Without it, alerts are only
 * written to the server log.
 */

const REQUEST_TIMEOUT_MS = 10 * 1000;
const WEBHOOK_PATTERN =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/** The configured webhook URL, or null when unset or not a Discord webhook. */
export const discordWebhookUrl = () => {
  const url = (process.env.ALERT_DISCORD_WEBHOOK_URL || "").trim();
  if (!url) return null;
  if (!WEBHOOK_PATTERN.test(url)) {
    logger.warn("ALERT_DISCORD_WEBHOOK_URL is not a Discord webhook URL — alerts are not sent");
    return null;
  }
  return url;
};

/** Discord's limits: 10 embeds per message, 256-char titles, 4096-char descriptions. */
const clip = (text, max) => {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/**
 * Post one message. Mentions are switched off, so a venue or court name can
 * never ping @everyone. A 429 is retried once after Discord's `retry_after`.
 *
 * @param {{ content?: string, embeds?: object[] }} message
 * @param {{ url?: string|null, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export const postDiscord = async (
  message,
  { url = discordWebhookUrl(), fetchImpl = fetch } = {}
) => {
  if (!url) return { sent: false, reason: "not configured" };

  const body = JSON.stringify({
    username: process.env.ALERT_DISCORD_USERNAME || "DGSports",
    allowed_mentions: { parse: [] },
    ...(message.content ? { content: clip(message.content, 2000) } : {}),
    embeds: (message.embeds || []).slice(0, 10).map((embed) => ({
      ...embed,
      title: clip(embed.title, 256),
      description: clip(embed.description, 4096),
    })),
  });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return { sent: true };
      if (res.status === 429 && attempt === 1) {
        const data = await res.json().catch(() => ({}));
        const waitMs = Math.min(Math.max(Number(data.retry_after) || 1, 0.1), 30) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      logger.error("Discord alert refused", { status: res.status });
      return { sent: false, reason: `HTTP ${res.status}` };
    } catch (err) {
      logger.error("Discord alert failed", { error: err.name === "TimeoutError" ? "timeout" : err.message });
      return { sent: false, reason: err.message };
    }
  }
  return { sent: false, reason: "rate limited" };
};
