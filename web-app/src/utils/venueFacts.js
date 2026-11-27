/**
 * PLAN-009 phase B: the fixed lists behind a court's surface, a venue's
 * amenities and a player's skill level — the same values as the API
 * (back/server/src/utils/venueFacts.js). web-app/src/utils/venueFacts.js is a copy.
 */
export const COURT_SURFACES = ["Hard", "Synthetic", "Wood", "Concrete", "Other"];
export const VENUE_AMENITIES = ["Parking", "Showers", "Lockers", "Restrooms", "Food", "Pro shop", "Lights", "Aircon"];
export const SKILL_LEVELS = ["Beginner", "Low Intermediate", "Intermediate", "High Intermediate", "Advanced"];

/** Select value for "not said" (a Radix Select item can't have an empty value). */
export const NOT_SAID = "none";

/** isIndoor (true / false / null) ⇄ the court form's select value. */
export const indoorToSelect = (isIndoor) => (isIndoor === true ? "indoor" : isIndoor === false ? "outdoor" : NOT_SAID);
export const selectToIndoor = (value) => (value === "indoor" ? true : value === "outdoor" ? false : null);
