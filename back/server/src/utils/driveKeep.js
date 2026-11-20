import { moment } from "./dateUtils.js";

/**
 * CR-026: a video's Google Drive copy is kept this many days after the video
 * was saved (`dateCreated`), then moved to the Drive's trash
 * (jobs/driveCleanup.js) — on its own clock, while the server keeps the video
 * for the venue's days (7 by default). If the server copy expires first, the
 * Drive copy goes with it.
 *
 * The web pages say "2 days" — change them too if this changes.
 */
export const DRIVE_KEEP_DAYS = 2;

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";

/** Videos saved at or before this (Manila DATETIME) are past their Drive keep time. */
export const driveKeepCutoff = () =>
  moment().tz(TIMEZONE).subtract(DRIVE_KEEP_DAYS, "days").format("YYYY-MM-DD HH:mm:ss");
