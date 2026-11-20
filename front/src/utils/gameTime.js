import { z } from "zod";

/**
 * CR-016: a game time as Hours + Minutes, shared by New game and Add time.
 * The form keeps both as strings ("1", "30"); `gameTimeFields` is the zod
 * shape for them and `toGameMinutes` turns them into whole minutes.
 */
export const gameTimeFields = {
  hours: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d+$/.test(v), "Whole hours"),
  minutes: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d+$/.test(v), "Whole minutes")
    .refine((v) => v === "" || Number(v) <= 59, "0 to 59 — use hours for more"),
};

/** { hours: "1", minutes: "30" } → 90 */
export const toGameMinutes = ({ hours, minutes }) =>
  (Number(hours) || 0) * 60 + (Number(minutes) || 0);

/** 90 → { hours: "1", minutes: "30" } */
export const fromGameMinutes = (total) => ({
  hours: String(Math.floor(total / 60)),
  minutes: String(total % 60),
});
