import express from "express";
import fs from "node:fs";
import path from "node:path";
import { uploadLimiter } from "../../../middlewares/rateLimiter.js";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { canAccessUpload, compressImage, upload } from "../../../utils/file/uploads.js";
import APIError from "../../../utils/APIError.js";
import { deleteFileSchema } from "../../../validators/upload.validator.js";

const router = express.Router();

const UPLOAD_ROOT = path.resolve("public", "uploads");

// Response body for a stored upload: `path` is what the client saves on a
// record, `url` is the signed link it can display right away.
const uploadedFile = (file) => {
  const filePath = `/${file.path.replace(/\\/g, "/")}`;
  return {
    path: filePath,
    url: signUploadUrl(filePath),
    filename: file.filename,
    size: file.size,
    mimetype: file.mimetype,
  };
};

// ─── Upload configurations ──────────────────────────────────────────────────

// User avatar: uploads/admin/avatars/{accountId}/
const adminAvatarUpload = upload({
  filePath: (req) => `uploads/admin/avatars/${req.user.accountId}`,
  fileTypes: ["images"],
  maxFileSize: 1024 * 1024 * 2, // 2MB
});

// General image: uploads/admin/images/
const adminImageUpload = upload({
  filePath: () => "uploads/admin/images",
  fileTypes: ["images"],
  maxFileSize: 1024 * 1024 * 5, // 5MB
});

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /avatar
 * Upload the caller's avatar
 * Path: uploads/admin/avatars/{accountId}/
 */
router.post(
  "/avatar",
  uploadLimiter,
  adminAvatarUpload.single("avatar"),
  compressImage,
  catchAsync(async (req, res) => {
    if (!req.file) {
      throw new APIError("No file uploaded", 400);
    }

    return res.sendSuccess("Avatar uploaded successfully", uploadedFile(req.file));
  })
);

/**
 * POST /image
 * Upload a general image
 * Path: uploads/admin/images/
 */
router.post(
  "/image",
  uploadLimiter,
  adminImageUpload.single("file"),
  compressImage,
  catchAsync(async (req, res) => {
    if (!req.file) {
      throw new APIError("No file uploaded", 400);
    }

    return res.sendSuccess("Image uploaded successfully", uploadedFile(req.file));
  })
);

/**
 * DELETE /file
 * Delete an uploaded file from the server.
 * In per-user folders (avatars, signatures) a user may delete only their own.
 */
router.delete(
  "/file",
  validateBody(deleteFileSchema),
  catchAsync(async (req, res) => {
    const { path: filePath } = req.body;

    // Security: the resolved path must stay inside public/uploads
    const absolutePath = path.resolve(filePath.replace(/^[/\\]+/, ""));
    if (!absolutePath.startsWith(UPLOAD_ROOT + path.sep)) {
      throw new APIError("Invalid file path", 400);
    }

    // Someone else's per-user file is reported as missing, same as a wrong path
    const isFile = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
    if (!isFile || !canAccessUpload(req.user, filePath)) {
      throw new APIError("File not found", 404);
    }

    fs.unlinkSync(absolutePath);

    return res.sendSuccess("File deleted successfully");
  })
);

export default router;
