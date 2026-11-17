import { ERROR_CODES } from "../utils/APIError.js";
import { UPLOAD_URL_PREFIX, verifyUploadSignature } from "../utils/file/signedUrl.js";

/**
 * Guard for the uploads folder
 *
 * Mount in front of the static handler for `/public/uploads`. A file is served
 * only through a link produced by `signUploadUrl()` that has not expired; a
 * bare path, an altered path, or an old link gets a 403.
 */
export const requireSignedUpload = (req, res, next) => {
  let storedPath = null;
  try {
    // req.path is relative to the mount point, e.g. "/admin/images/.../x.png"
    storedPath = UPLOAD_URL_PREFIX.slice(0, -1) + decodeURIComponent(req.path);
  } catch {
    // Malformed percent-encoding — falls through to the 403 below
  }

  const secondsLeft = verifyUploadSignature(
    storedPath,
    Number(req.query.expires),
    req.query.signature
  );

  if (!secondsLeft) {
    return res.status(403).json({
      success: false,
      message: "This file link is invalid or has expired",
      code: ERROR_CODES.FORBIDDEN,
    });
  }

  // The link is personal and short-lived — let the browser cache it, not proxies
  res.setHeader("Cache-Control", `private, max-age=${secondsLeft}`);

  // `&download=1` asks the browser to save the file instead of opening it. The
  // HTML `download` attribute is ignored on cross-origin links (web app and API
  // on different hosts), so this is how a "Download" button works everywhere.
  // Not part of the signature: it changes how the same file is delivered.
  if (req.query.download === "1") {
    // A friendly name for the saved file (the stored one is 64 random hex characters)
    const extension = storedPath.slice(storedPath.lastIndexOf("."));
    res.attachment(`dyna-cam-replay${extension}`);
  }
  next();
};

export default requireSignedUpload;
