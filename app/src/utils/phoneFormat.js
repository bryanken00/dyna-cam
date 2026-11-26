/**
 * Philippine mobile number helpers — a port of front/src/utils/phoneFormat.js
 * (without zod). Canonical format: `09XX XXXX XXX`, e.g. `0912 3456 789`;
 * the UI hint is always that example, never the `09XX…` mask.
 */

export const PHONE_PLACEHOLDER = "0912 3456 789";

/** Canonical length once formatted: 11 digits + 2 spaces. */
export const PHONE_MAX_LENGTH = 13;

/** Any accepted input → bare local digits (`09XXXXXXXXX`); +63 / 63 / 9… prefixes allowed. */
export const toLocalDigits = (phone) => {
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.startsWith("9") && digits.length === 10) digits = `0${digits}`;
  return digits;
};

export const isValidPhoneNumber = (phone) => /^09\d{9}$/.test(toLocalDigits(phone));

/** 4-4-3, tolerating partial input: "0912" → "0912", "09123456" → "0912 3456". */
export const groupPhoneDigits = (digits) => {
  const d = digits.slice(0, 11);
  return [d.slice(0, 4), d.slice(4, 8), d.slice(8, 11)].filter(Boolean).join(" ");
};

/** For a field's onChangeText — types the spaces in for the user. */
export const formatPhoneOnChange = (value) => groupPhoneDigits(toLocalDigits(value));

/** A stored value for display; odd legacy data is shown as it is. */
export const formatPhoneDisplay = (phone) => {
  if (!phone) return "";
  const digits = toLocalDigits(phone);
  return isValidPhoneNumber(digits) ? groupPhoneDigits(digits) : phone;
};
