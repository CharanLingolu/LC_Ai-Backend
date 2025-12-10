// src/utils/uploadToCloudinary.js
import { v2 as cloudinary } from "cloudinary";

/**
 * Upload a buffer to Cloudinary, preserving file type.
 *
 * @param {Buffer} buffer - file bytes
 * @param {Object} options
 *   - folder?: string
 *   - resource_type?: string (optional override)
 *   - originalName?: string (required for best filename)
 *   - mimetype?: string (optional, helps detect type)
 */
export function uploadToCloudinary(buffer, options = {}) {
  const originalName = options.originalName || "file";
  const mimetype = options.mimetype || "";

  const ext = originalName.split(".").pop()?.toLowerCase() || "";

  const isImage =
    mimetype.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext);

  const isVideo =
    mimetype.startsWith("video/") ||
    ["mp4", "webm", "mov", "mkv", "avi"].includes(ext);

  const isPdf = mimetype === "application/pdf" || ext === "pdf";

  // decide resource_type
  let resource_type;
  if (options.resource_type) {
    resource_type = options.resource_type;
  } else if (isImage) {
    resource_type = "image";
  } else if (isVideo) {
    resource_type = "video";
  } else {
    resource_type = "raw";
  }

  // PDFs MUST be raw to keep the real PDF bytes
  if (isPdf) {
    resource_type = "raw";
  }

  const publicIdBase = originalName.replace(/\.[^/.]+$/, "");
  const folder = options.folder || "lc_ai_chat_uploads";

  const uploadOptions = {
    folder,
    resource_type,
    use_filename: true,
    unique_filename: true,
    filename_override: originalName,
    public_id: publicIdBase,
  };

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );

    stream.end(buffer);
  });
}
