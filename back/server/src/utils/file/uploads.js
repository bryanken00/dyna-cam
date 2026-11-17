import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import APIError, { ERROR_CODES } from "../APIError.js";
import { catchAsync } from "../catchAsync.js";

// Everything multer writes must stay inside this folder
const UPLOAD_ROOT = path.resolve("public", "uploads");

// A client-sent ID that becomes a folder name must look like a business ID.
// Use this in a `filePath` callback whenever the ID does not come from req.user.
const BUSINESS_ID = /^[A-Za-z0-9-]{1,50}$/;
export const uploadFolderId = (value) => {
  if (typeof value !== "string" || !BUSINESS_ID.test(value)) {
    throw new APIError(
      "A valid ID is required for this upload",
      400,
      ERROR_CODES.VALIDATION_FAILED
    );
  }
  return value;
};

// Folders filed per user: admin/{folder}/{accountId}/
const USER_SCOPED_FOLDERS = ["avatars", "signatures"];

/**
 * Whether `user` may delete an upload, or save its path on a record (which
 * makes the API hand back a signed link to it).
 *
 * Any file inside public/uploads/admin/ — except that in per-user folders
 * (avatars, signatures) only the user's own.
 *
 * @param {Object} user - req.user
 * @param {string} storedPath - "/public/uploads/..." as stored in the database
 */
export const canAccessUpload = (user, storedPath) => {
  if (typeof storedPath !== "string") return false;

  const absolutePath = path.resolve(storedPath.replace(/^[/\\]+/, ""));
  if (!absolutePath.startsWith(UPLOAD_ROOT + path.sep)) return false;

  const [portal, folder, owner] = path.relative(UPLOAD_ROOT, absolutePath).split(path.sep);
  if (portal !== "admin") return false;
  return !USER_SCOPED_FOLDERS.includes(folder) || owner === user.accountId;
};

// SVG is deliberately absent: it can carry script and is served from this origin.
const FILE_TYPE_CONFIGS = {
  images: {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/gif": [".gif"],
    "image/webp": [".webp"],
    "image/bmp": [".bmp"],
    "image/tiff": [".tiff", ".tif"],
    "image/heic": [".heic"],
    "image/heif": [".heif"],
  },
  documents: {
    "application/pdf": [".pdf"],
    "application/msword": [".doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    "application/vnd.ms-excel": [".xls"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    "text/plain": [".txt"],
    "text/csv": [".csv"],
  },
  audio: {
    "audio/mpeg": [".mp3"],
    "audio/wav": [".wav"],
    "audio/ogg": [".ogg"],
    "audio/aac": [".aac"],
  },
  video: {
    "video/mp4": [".mp4"],
    "video/quicktime": [".mov"],
    "video/x-msvideo": [".avi"],
    "video/webm": [".webm"],
  },
};

// Helper function to get allowed types from config
const getAllowedTypes = (fileTypes) => {
  const result = {};
  fileTypes.forEach((type) => {
    if (FILE_TYPE_CONFIGS[type]) {
      Object.assign(result, FILE_TYPE_CONFIGS[type]);
    }
  });
  return result;
};

// Helper function to validate file
const validateFile = (allowedTypes, mimeType, fileExt) => {
  if (!allowedTypes[mimeType]) {
    return { valid: false, error: `MIME type '${mimeType}' is not allowed` };
  }

  if (!allowedTypes[mimeType].includes(fileExt)) {
    return {
      valid: false,
      error: `Extension '${fileExt}' does not match MIME type '${mimeType}'. Expected: ${allowedTypes[
        mimeType
      ].join(", ")}`,
    };
  }

  return { valid: true };
};

// ─── Content checks ─────────────────────────────────────────────────────────
// The MIME type and extension are both sent by the client, so on their own they
// prove nothing. After multer writes the file, its first bytes must match the
// signature of the type it claims to be. A type with no check here is rejected.

const text = (buf, start, end) => buf.toString("latin1", start, end);
const startsWith = (buf, bytes) => bytes.every((byte, i) => buf[i] === byte);
const isRiff = (kind) => (buf) => text(buf, 0, 4) === "RIFF" && text(buf, 8, 12) === kind;
const isIsoMedia = (brands) => (buf) =>
  text(buf, 4, 8) === "ftyp" && (!brands || brands.includes(text(buf, 8, 12)));
const isOleDocument = (buf) => startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const isZipDocument = (buf) => startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
const isPlainText = (buf) => !buf.includes(0);
const HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

const CONTENT_CHECKS = {
  "image/jpeg": (buf) => startsWith(buf, [0xff, 0xd8, 0xff]),
  "image/png": (buf) => startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/gif": (buf) => ["GIF87a", "GIF89a"].includes(text(buf, 0, 6)),
  "image/webp": isRiff("WEBP"),
  "image/bmp": (buf) => text(buf, 0, 2) === "BM",
  "image/tiff": (buf) =>
    startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a]),
  "image/heic": isIsoMedia(HEIF_BRANDS),
  "image/heif": isIsoMedia(HEIF_BRANDS),
  "application/pdf": (buf) => text(buf, 0, 5) === "%PDF-",
  "application/msword": isOleDocument,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZipDocument,
  "application/vnd.ms-excel": isOleDocument,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZipDocument,
  "text/plain": isPlainText,
  "text/csv": isPlainText,
  "audio/mpeg": (buf) => text(buf, 0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0),
  "audio/wav": isRiff("WAVE"),
  "audio/ogg": (buf) => text(buf, 0, 4) === "OggS",
  "audio/aac": (buf) => buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0,
  "video/mp4": isIsoMedia(),
  "video/quicktime": (buf) =>
    isIsoMedia()(buf) || ["moov", "mdat", "free", "wide"].includes(text(buf, 4, 8)),
  "video/x-msvideo": isRiff("AVI "),
  "video/webm": (buf) => startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3]),
};

const SIGNATURE_BYTES = 512;

const contentMatchesType = async (file) => {
  const check = CONTENT_CHECKS[file.mimetype];
  if (!check) return false;

  const handle = await fs.promises.open(file.path, "r");
  try {
    const { buffer, bytesRead } = await handle.read(
      Buffer.alloc(SIGNATURE_BYTES),
      0,
      SIGNATURE_BYTES,
      0
    );
    return bytesRead > 0 && check(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
};

// multer exposes uploads as req.file, an array, or a field → array map
const uploadedFiles = (req) => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  return Object.values(req.files || {}).flat();
};

// Reject the whole request (and remove what was written) if any file's
// content does not match its declared type.
const verifyUploadedContent = async (req) => {
  const files = uploadedFiles(req);
  const checks = await Promise.all(files.map(contentMatchesType));

  if (checks.every(Boolean)) return;

  await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => {})));
  throw new APIError(
    "File content does not match its file type",
    400,
    ERROR_CODES.VALIDATION_FAILED
  );
};

const storage = (options) =>
  multer.diskStorage({
    destination: (req, _file, cb) => {
      let destPath;
      try {
        destPath = path.join("public", options.filePath(req, _file));
      } catch (err) {
        return cb(err);
      }

      // The folder is built from request data — never let it leave public/uploads
      if (!path.resolve(destPath).startsWith(UPLOAD_ROOT + path.sep)) {
        return cb(new APIError("Invalid upload path", 400, ERROR_CODES.VALIDATION_FAILED));
      }

      const isExists = fs.existsSync(destPath);
      if (!isExists) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      cb(null, destPath);
    },
    filename: (_req, file, cb) => {
      // Uploads are served without login, so the name must not be guessable
      const ext = path.extname(file.originalname).toLowerCase();
      const filename = `${crypto.randomBytes(32).toString("hex")}${ext}`;

      cb(null, filename);
    },
  });

const formatFileSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
};

const wrapMulterMethod = (multerInstance, method, options) =>
  (...args) => {
    const middleware = method.apply(multerInstance, args);
    return (req, res, next) => {
      middleware(req, res, (err) => {
        if (err instanceof multer.MulterError) {
          const maxSize = options.maxFileSize || 1024 * 1024 * 3;
          const messages = {
            LIMIT_FILE_SIZE: `File too large. Maximum file size is ${formatFileSize(maxSize)}`,
            LIMIT_FILE_COUNT: "Too many files uploaded",
            LIMIT_UNEXPECTED_FILE: "Unexpected file field",
          };
          return next(new APIError(messages[err.code] || err.message, 400, ERROR_CODES.VALIDATION_FAILED));
        }
        if (err) return next(err);
        verifyUploadedContent(req).then(() => next(), next);
      });
    };
  };

export const upload = (options) => {
  const multerInstance = multer({
    storage: storage(options),
    fileFilter: (_req, file, cb) => {
      const mimeType = file.mimetype;
      const fileExt = path.extname(file.originalname).toLowerCase();

      // If specific file types are defined, use them
      if (options.fileTypes) {
        const allowedTypes = getAllowedTypes(options.fileTypes);
        const validation = validateFile(allowedTypes, mimeType, fileExt);

        if (validation.valid) {
          cb(null, true);
        } else {
          cb(new APIError(validation.error, 400));
        }
      }
      // If custom allowedTypes object is provided (legacy support)
      else if (options.allowedTypes) {
        const validation = validateFile(options.allowedTypes, mimeType, fileExt);

        if (validation.valid) {
          cb(null, true);
        } else {
          cb(new APIError(validation.error, 400));
        }
      } else {
        cb(new APIError("Invalid file type", 400));
      }
    },
    limits: {
      fileSize: options.maxFileSize || 1024 * 1024 * 3, // Default 3MB, customizable
    },
  });

  return {
    single: wrapMulterMethod(multerInstance, multerInstance.single, options),
    array: wrapMulterMethod(multerInstance, multerInstance.array, options),
    fields: wrapMulterMethod(multerInstance, multerInstance.fields, options),
    none: wrapMulterMethod(multerInstance, multerInstance.none, options),
    any: wrapMulterMethod(multerInstance, multerInstance.any, options),
  };
};
/**
 * Compress uploaded images to reduce file size
 * Supports JPEG, PNG, WebP formats
 * Progressively reduces quality until target size is met
 */
export const compressImage = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next();
  }

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;
  const ext = path.extname(filePath).toLowerCase();

  // Only compress image files
  const compressibleImages = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
  };

  // Check if file type is compressible
  if (!compressibleImages[mimeType] || !compressibleImages[mimeType].includes(ext)) {
    return next();
  }

  try {
    let fileSize = fs.statSync(filePath).size;
    const targetSize = 1024 * 1024; // 1MB target
    let quality = 80; // Start with higher quality

    // Only compress if file is larger than target
    if (fileSize <= targetSize) {
      return next();
    }

    const tempPath = filePath.replace(ext, `-compressed${ext}`);

    // Compression loop with quality reduction
    while (fileSize > targetSize && quality >= 20) {
      // Delete previous temp file if exists
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }

      // Compress image based on format
      if (mimeType === "image/png") {
        await sharp(filePath).png({ quality, compressionLevel: 9 }).toFile(tempPath);
      } else if (mimeType === "image/webp") {
        await sharp(filePath).webp({ quality }).toFile(tempPath);
      } else {
        // JPEG/JPG
        await sharp(filePath).jpeg({ quality, mozjpeg: true }).toFile(tempPath);
      }

      fileSize = fs.statSync(tempPath).size;
      quality -= 10;
    }

    // Replace original with compressed version
    fs.unlinkSync(filePath);
    fs.renameSync(tempPath, filePath);

    // Update req.file with new size
    req.file.size = fs.statSync(filePath).size;
  } catch (error) {
    // If compression fails, continue with original file
    console.error("Image compression failed:", error);
    // Clean up temp file if exists
    const tempPath = filePath.replace(ext, `-compressed${ext}`);
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }

  next();
});
