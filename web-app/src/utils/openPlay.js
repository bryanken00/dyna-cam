import { SKILL_LEVELS } from "./venueFacts";

/**
 * PLAN-009 phase C: words for an Open Play session on player pages.
 */

/** "Beginner – Intermediate", "Intermediate and up", "All levels". */
export const levelRange = (min, max) => {
  if (min && max) return min === max ? min : `${min} – ${max}`;
  if (min) return `${min} and up`;
  if (max) return `Up to ${max}`;
  return "All levels";
};

/** Does a player's level fit the session's range? (No level, or no range: yes.) */
export const levelFits = (level, min, max) => {
  if (!level) return true;
  const at = SKILL_LEVELS.indexOf(level);
  if (min && at < SKILL_LEVELS.indexOf(min)) return false;
  if (max && at > SKILL_LEVELS.indexOf(max)) return false;
  return true;
};

/** 0 → "Full", 1 → "1 spot left", 7 → "7 spots left". */
export const spotsText = (left) => (left <= 0 ? "Full" : left === 1 ? "1 spot left" : `${left} spots left`);
