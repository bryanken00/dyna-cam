import { DEVICE_ONLINE_SECONDS, secondsAgoLocal } from "./clips.js";

/**
 * Whether a court can record right now — for the court's Start a game page
 * (CR-027). Until CR-027 this file also saved 60-second clips from the court
 * QR and the court button; that is gone, and clips already saved only expire.
 */

/** Columns every caller needs to decide whether a court can record. */
export const COURT_RECORDING_COLUMNS = `
  c.courtId, c.venueId, c.name, c.cameraRtspUrl IS NOT NULL AS hasCamera,
  v.name AS venueName, v.logoUrl, c.streamEnabled, c.streamWatchUrl,
  EXISTS (
    SELECT 1 FROM devices d
    WHERE d.venueId = c.venueId AND d.status = 'Active' AND d.lastSeenAt >= ?
  ) AS recorderOnline`;

/** The `?` parameter COURT_RECORDING_COLUMNS needs (first in the list). */
export const onlineSince = () => secondsAgoLocal(DEVICE_ONLINE_SECONDS);
