/**
 * TP-Link Tapo camera helpers (C200 and friends).
 *
 * A Tapo camera serves RTSP on port 554 with a "Camera Account" the owner sets
 * up in the Tapo app (Camera settings → Advanced settings → Camera Account) —
 * not their Tapo cloud login. Two streams:
 *   stream1 — high quality (the camera's quality setting: a C200 set to "HD"
 *             sends 1280×720; set it to 1080p in the Tapo app for full HD)
 *   stream2 — low quality (640×360)
 *
 * Pure functions only — no React, no network — so they are easy to check.
 */

/** The quality choices, in the order the drawer shows them. */
export const TAPO_STREAMS = [
  { value: "stream1", label: "High (stream1)" },
  { value: "stream2", label: "Low (stream2)" },
];

export const TAPO_DEFAULT_STREAM = "stream1";

/** Tapo's own limit for a Camera Account username and password. */
export const TAPO_CREDENTIAL_MIN = 6;
export const TAPO_CREDENTIAL_MAX = 32;

export const TAPO_RTSP_PORT = 554;

/** A dotted-quad IPv4 address, each part 0–255 with no leading zeros. */
export const isValidIPv4 = (value) => {
  if (typeof value !== "string") return false;
  const parts = value.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every(
    (p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255,
  );
};

/**
 * Build the RTSP URL the recorder box opens for a Tapo camera.
 *
 * Username and password are percent-encoded: Tapo passwords often contain "@",
 * ":" or "/", which would otherwise break the URL (an unencoded "@" makes
 * everything before it look like the host).
 *
 *   buildTapoRtspUrl({ ip: "192.168.1.50", username: "court1", password: "p@ss:w/rd" })
 *   → "rtsp://court1:p%40ss%3Aw%2Frd@192.168.1.50:554/stream1"
 *
 * @param {{ ip: string, username: string, password: string, stream?: string }} input
 * @returns {string}
 */
export const buildTapoRtspUrl = ({
  ip,
  username,
  password,
  stream = TAPO_DEFAULT_STREAM,
}) => {
  const safeStream = TAPO_STREAMS.some((s) => s.value === stream)
    ? stream
    : TAPO_DEFAULT_STREAM;
  return `rtsp://${encodeURIComponent(username)}:${encodeURIComponent(
    password,
  )}@${String(ip).trim()}:${TAPO_RTSP_PORT}/${safeStream}`;
};

/** True for an rtsp:// or rtsps:// URL — the same rule the API applies. */
export const isRtspUrl = (value) => {
  try {
    return ["rtsp:", "rtsps:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
