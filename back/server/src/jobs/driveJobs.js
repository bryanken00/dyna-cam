import { logger } from "../../config/logger.js";
import { runDriveCleanup } from "./driveCleanup.js";
import { runDriveEmails } from "./driveEmails.js";

/**
 * Google Drive housekeeping, every 30 s (CR-040 Phase 4: the API no longer
 * uploads anything — the venue's recorder box sends each video straight to the
 * court's Drive):
 *
 * 1. CR-018: email each finished, paid game's Drive link to its player
 *    (jobs/driveEmails.js);
 * 2. CR-017 / CR-026: move Drive copies to the trash once their keep time is
 *    over (jobs/driveCleanup.js).
 */
const INTERVAL_MS = 30 * 1000;

/** One pass: emails, then deletes. Each step's failure is logged, never thrown. */
export const runDriveJobs = async (db) => {
  try {
    const tally = await runDriveEmails(db);
    if (tally && Object.keys(tally).length > 0) logger.info("Game Drive emails", tally);
  } catch (err) {
    logger.error("Game Drive emails failed", { error: err.message });
  }
  try {
    const tally = await runDriveCleanup(db);
    if (tally && Object.keys(tally).length > 0) logger.info("Google Drive deletes", tally);
  } catch (err) {
    logger.error("Google Drive deletes failed", { error: err.message });
  }
};

/**
 * Run every `intervalMs`, one pass at a time. Returns a function that stops it.
 * @param {import("../../config/database.js").default} db
 */
export const scheduleDriveJobs = (db, intervalMs = INTERVAL_MS) => {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runDriveJobs(db).finally(() => {
      running = false;
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref(); // never keep the process alive just for this
  return () => clearInterval(timer);
};
