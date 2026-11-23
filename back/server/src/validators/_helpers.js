import { z } from "zod";

import { toStoredPath } from "../utils/file/signedUrl.js";

/**
 * Wrap a schema so an "empty" value is treated as absent (undefined).
 *
 * Three shapes all mean "no value" for an optional field mapped to a NULLable
 * column, and all three must be accepted:
 *   - `""`        HTML forms and multipart/form-data send this for cleared
 *                 fields; a query string sends it for any rendered-but-unset param
 *   - `null`      what a JSON client sends to explicitly clear a field (our own
 *                 form drawers post `value || null`)
 *   - `undefined` the key omitted entirely
 *
 * Normalising to `undefined` lets `.optional()` accept all three, and the
 * controllers' `value || null` then writes SQL NULL. This matches the
 * "optional/nullable fields mirror the column's NULL constraint" rule in
 * docs/validators.md.
 */
export const emptyToUndefined = (schema) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), schema);

/** Optional free-text string, capped at `max`, tolerant of "". */
export const optionalString = (max) =>
  emptyToUndefined(z.string().max(max).optional());

/** Optional email, capped at `max`, tolerant of "". */
export const optionalEmail = (max = 100) =>
  emptyToUndefined(z.string().email("Invalid email address").max(max).optional());

/**
 * A password someone is SETTING (create user, change, reset) — never the one
 * they sign in with. This checks the length only. The handler must also call
 * `passwordProblem(password, { email })` from utils/passwordPolicy.js, which
 * refuses well-known weak passwords and ones built from the account's email.
 * That check lives in the handler because it needs the account's email, and
 * because its message is shown to the user as is (a schema failure only says
 * "Validation failed").
 */
export const newPassword = () =>
  z.string().min(8, "Password must be at least 8 characters").max(255);

/**
 * Optional path of an uploaded file (`logoUrl`, `imageUrl`, …).
 *
 * The API hands these out as signed links, and a form sends back whatever it
 * was given. So accept the long signed form (or a full URL) and **transform it
 * to the stored `/public/uploads/...` path** — the DB never holds a signature.
 * `max` is the column length, checked after the transform.
 */
export const optionalUploadPath = (max = 255) =>
  emptyToUndefined(
    z
      .string()
      .max(1000)
      .optional()
      .transform((v) => (v === undefined ? undefined : toStoredPath(v)))
      .refine((v) => v === undefined || v.length <= max, `Must be at most ${max} characters`),
  );

/**
 * A Manila local date and time as sent by the Admin portal: "YYYY-MM-DD HH:mm"
 * (or with seconds, or a "T" between), normalised to "YYYY-MM-DD HH:mm:ss".
 */
const LOCAL_MINUTES = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;
const LOCAL_SECONDS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;
export const localDateTime = () =>
  z
    .string()
    .trim()
    .refine(
      (value) => LOCAL_MINUTES.test(value) || LOCAL_SECONDS.test(value),
      "Use a YYYY-MM-DD HH:mm date and time",
    )
    .transform((value) => {
      const normalised = value.replace("T", " ");
      return normalised.length === 16 ? `${normalised}:00` : normalised;
    });

/* ── Phone ──────────────────────────────────────────────────────────────────
 * Canonical stored format is `09XX XXXX XXX` (PH mobile, 11 digits grouped
 * 4-4-3). See the phone entry in the repo-root CLAUDE.md.
 */

/** Strip to digits and normalise the common PH prefixes to `09XXXXXXXXX`. */
export const toLocalDigits = (input) => {
  const digits = String(input).replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length === 12) return `0${digits.slice(2)}`; // 639…
  if (digits.startsWith("9") && digits.length === 10) return `0${digits}`; // 9…
  return digits;
};

/** `09XXXXXXXXX` → `09XX XXXX XXX` */
export const formatPhone = (digits) =>
  `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;

/**
 * Optional PH mobile number.
 *
 * Accepts the canonical grouped form, bare 11 digits, and `+63`/`63`/`9…`
 * variants (so API clients aren't forced to pre-format), then **transforms to
 * `09XX XXXX XXX`** — controllers and the DB only ever see the canonical form.
 * Empty string / null / omitted all mean "no number".
 */
export const optionalPhone = () =>
  emptyToUndefined(
    z
      .string()
      .max(20)
      .optional()
      .refine(
        (v) => v === undefined || /^09\d{9}$/.test(toLocalDigits(v)),
        "Phone must be a valid PH mobile number, e.g. 0912 3456 789",
      )
      .transform((v) => (v === undefined ? undefined : formatPhone(toLocalDigits(v)))),
  );

/* ── Query-string helpers ───────────────────────────────────────────────────
 * A query string cannot express "absent" for a rendered param: an unset filter
 * arrives as `?status=` (empty string), not as a missing key. axios serialises
 * `{ status: "" }` exactly that way. So EVERY optional query field must treat ""
 * as absent, or a default page load 400s. Use these instead of bare z.enum().
 */

/** Optional enum filter, tolerant of "". */
export const queryEnum = (values) => emptyToUndefined(z.enum(values).optional());

/**
 * Enum with a fallback (sortBy/sortOrder). "" → the default, so the controller
 * never receives undefined for a field it calls .toUpperCase() on.
 */
export const queryEnumDefault = (values, defaultValue) =>
  emptyToUndefined(z.enum(values).default(defaultValue));

/** Coerced positive integer with a fallback ("" would otherwise coerce to 0). */
export const queryInt = (defaultValue, { min = 1, max } = {}) => {
  let schema = z.coerce.number().int().min(min);
  if (max !== undefined) schema = schema.max(max);
  return emptyToUndefined(schema.default(defaultValue));
};
