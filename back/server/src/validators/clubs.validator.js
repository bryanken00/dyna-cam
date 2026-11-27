import { z } from "zod";
import { emptyToUndefined, optionalString, queryEnum } from "./_helpers.js";

/** PLAN-009 phase F: clubs (controllers/v1/admin/clubs, public/clubs, player/clubs). */

const clubFields = {
  name: z.string().trim().min(1, "Name the club").max(100),
  description: optionalString(1000),
  joinPolicy: z.enum(["Open", "Approval"]).default("Open"),
};

export const createClubSchema = z.object({ venueId: z.string().min(1, "Pick a venue").max(50), ...clubFields });
export const updateClubSchema = z.object({ ...clubFields, status: z.enum(["Active", "Inactive"]).optional() });

export const listClubsQuerySchema = z.object({
  venueId: emptyToUndefined(z.string().max(50).optional()),
  status: queryEnum(["Active", "Inactive"]),
});

// PUT /admin/clubs/members/:clubMemberId — approve, make admin, take out
export const memberActionSchema = z.object({
  status: z.enum(["Active", "Removed"]).optional(),
  role: z.enum(["Member", "Admin"]).optional(),
});

export const clubTokenParamsSchema = z.object({
  clubToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "This club link isn't valid"),
});
