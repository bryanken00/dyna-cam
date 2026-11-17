import { z } from "zod";
import { toStoredPath } from "../utils/file/signedUrl.js";

// DELETE /file — delete a previously uploaded file
// Clients hold the signed link (or a full URL), so reduce it to the stored path.
// (path-traversal + ownership checks are enforced in the controller)
export const deleteFileSchema = z.object({
  path: z.string().min(1, "File path is required").max(1000).transform(toStoredPath),
});
