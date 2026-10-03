const DRIVE_JPEG_MAX_BYTES = 500 * 1024;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("encode"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const text = String(dataUrl || "");
  const comma = text.indexOf(",");
  const meta = comma >= 0 ? text.slice(0, comma) : "";
  const payload = comma >= 0 ? text.slice(comma + 1) : "";
  if (!meta.startsWith("data:") || !payload) throw new Error("decode");
  const mime = meta.slice(5).split(";")[0] || "application/octet-stream";
  const binary = atob(payload.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        // Fall through to Image().
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderJpeg(bitmap, scale, quality) {
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("encode");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode"))),
      "image/jpeg",
      quality,
    );
  });
}

export function readOriginalImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("not_image"));
      return;
    }
    if (file.type && !file.type.startsWith("image/")) {
      reject(new Error("not_image"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

// Shrink a data-URL to a JPEG of at most 500 KB for a future Drive write
// (photo_drive_id). Must not run unless that same entry already has a
// non-empty description and a kcal value. Do not call this from save or
// buildEntry; those paths keep the original bytes.
export async function shrinkDataUrlForDrive(dataUrl) {
  const bitmap = await decodeImage(dataUrlToBlob(dataUrl));
  try {
    const longest = Math.max(bitmap.width, bitmap.height, 1);
    let scale = Math.min(1, 1600 / longest);
    for (let step = 0; step < 10; step += 1) {
      for (const quality of [0.85, 0.6, 0.45, 0.3]) {
        const jpeg = await renderJpeg(bitmap, scale, quality);
        if (jpeg.size <= DRIVE_JPEG_MAX_BYTES) return blobToDataUrl(jpeg);
      }
      scale *= 0.72;
    }
    throw new Error("encode");
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}
