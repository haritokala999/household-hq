export const MAX_RECEIPT_IMAGE_BYTES = 10 * 1024 * 1024;

export type ReceiptImageType = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";

/** Validate file size and image signatures instead of trusting the extension or MIME type. */
export function validateReceiptImage(size: number, header: Uint8Array): ReceiptImageType {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Choose an image that isn’t empty.");
  }
  if (size > MAX_RECEIPT_IMAGE_BYTES) {
    throw new Error("Choose an image smaller than 10 MB.");
  }

  const isJpeg = header.length >= 3
    && header[0] === 0xff
    && header[1] === 0xd8
    && header[2] === 0xff;
  const isPng = header.length >= 8
    && header[0] === 0x89
    && header[1] === 0x50
    && header[2] === 0x4e
    && header[3] === 0x47
    && header[4] === 0x0d
    && header[5] === 0x0a
    && header[6] === 0x1a
    && header[7] === 0x0a;
  const isWebp = header.length >= 12
    && String.fromCharCode(...header.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  const isIsoBaseMediaFile = header.length >= 12
    && String.fromCharCode(...header.slice(4, 8)) === "ftyp";
  const heifBrand = isIsoBaseMediaFile ? String.fromCharCode(...header.slice(8, 12)) : "";
  const heicBrands = new Set(["heic", "heix", "hevc", "hevx"]);
  const heifBrands = new Set(["mif1", "msf1"]);

  if (isJpeg) return "image/jpeg";
  if (isPng) return "image/png";
  if (isWebp) return "image/webp";
  if (heicBrands.has(heifBrand)) return "image/heic";
  if (heifBrands.has(heifBrand)) return "image/heif";
  throw new Error("Choose a valid JPEG, PNG, WebP, or HEIC receipt image.");
}
