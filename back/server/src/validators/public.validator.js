import { z } from "zod";

/** Validators for the no-login player routes (controllers/v1/public/). */

// Tokens come from utils/crypto/tokens.js (base64url). Rejecting anything else
// up front keeps junk out of the queries and the logs.
const token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Invalid link");

// /courts/:qrToken
export const courtTokenParamsSchema = z.object({ qrToken: token });

// /clips/:shareToken
export const clipTokenParamsSchema = z.object({ shareToken: token });

// /sessions/:shareToken
export const sessionTokenParamsSchema = z.object({ shareToken: token });
