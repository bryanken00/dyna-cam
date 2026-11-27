import { hashToken } from "./crypto/tokens.js";

/**
 * PLAN-009 phase B: what a venue and its courts are like, and how a player rates
 * themselves — the fixed lists the forms, the validators and Discover's filters
 * share. They match the ENUM / SET columns of migration 049.
 */
export const COURT_SURFACES = ["Hard", "Synthetic", "Wood", "Concrete", "Other"];
export const VENUE_AMENITIES = ["Parking", "Showers", "Lockers", "Restrooms", "Food", "Pro shop", "Lights", "Aircon"];
export const SKILL_LEVELS = ["Beginner", "Low Intermediate", "Intermediate", "High Intermediate", "Advanced"];
export const SPORTS = ["Pickleball"];

/** A venue's amenities column (MySQL SET: "Parking,Lights" / "" / NULL) → a list in the fixed order. */
export const amenityList = (value) => {
  const picked = new Set(String(value || "").split(",").filter(Boolean));
  return VENUE_AMENITIES.filter((a) => picked.has(a));
};

/** A list of amenities → the SET column's value (NULL when none). */
export const amenityValue = (list) => {
  const picked = new Set(list || []);
  const kept = VENUE_AMENITIES.filter((a) => picked.has(a));
  return kept.length ? kept.join(",") : null;
};

/**
 * A venue's public key: how player pages name a venue (follow, Book again)
 * without its business ID. Stable for the venue's life, unlike its booking
 * link, which staff can turn off or replace. SQL twin: VENUE_KEY_SQL.
 */
export const venueKey = (venueId) => hashToken(`venue-key:${venueId}`).slice(0, 16);

/** The same key computed in MySQL, for `WHERE ${VENUE_KEY_SQL("v")} = ?`. */
export const VENUE_KEY_SQL = (alias) => `LEFT(SHA2(CONCAT('venue-key:', ${alias}.venueId), 256), 16)`;
