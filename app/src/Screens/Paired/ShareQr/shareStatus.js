import { formatTime } from "@/utils/dynaCam";

/**
 * What the QR screen says under the code, for a 60-second clip or a whole
 * game. Pure: (kind, item) → { tone, text, note? }.
 *
 *   tone: "saving"    — still being made (with a loader)
 *         "recording" — a game still recording (the link already works)
 *         "ready"     — done
 *         "failed"    — couldn't be saved / expired / cancelled
 *         "info"      — a booked game that hasn't started
 */
export const describeClip = (clip) => {
  switch (clip?.status) {
    case undefined:
    case "Pending":
      return { tone: "saving", text: "Saving" };
    case "Ready":
      return { tone: "ready", text: "Ready" };
    case "Failed":
      return {
        tone: "failed",
        text: clip.failureReason
          ? `This clip couldn't be saved — ${clip.failureReason}`
          : "This clip couldn't be saved",
      };
    case "Expired":
      return { tone: "failed", text: "This clip has expired" };
    default:
      return { tone: "info", text: clip.status };
  }
};

export const describeGame = (game) => {
  const parts = game?.partsTotal
    ? `${game.partsReady ?? 0} of ${game.partsTotal} parts ready`
    : null;
  switch (game?.status) {
    case undefined:
    case "Processing":
      return {
        tone: "saving",
        text: parts ? `Saving the game… ${parts}` : "Saving the game…",
      };
    case "Recording":
      return { tone: "recording", text: "Still recording" };
    case "Ready":
      // Ready can still mean some parts failed — the API says which
      return { tone: "ready", text: "Ready", note: game.failureReason || null };
    case "Failed":
      return {
        tone: "failed",
        text: game.failureReason
          ? `The game couldn't be saved — ${game.failureReason}`
          : "The game couldn't be saved",
      };
    case "Cancelled":
      return { tone: "failed", text: "This game was cancelled" };
    case "Scheduled":
      return { tone: "info", text: `Booked · starts ${formatTime(game.startAt)}` };
    default:
      return { tone: "info", text: game.status };
  }
};
