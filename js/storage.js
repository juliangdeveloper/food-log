import { SCHEMA_VERSION, STORAGE_KEY } from "./config.js";
import { readOriginalImageFile } from "./image.js";
import { createEmptyEnvelope, imageKeyFor, isImageDataUrl, isImageKey, normalizeEnvelope } from "./model.js";
import { createStore, del, get, set } from "./vendor/idb-keyval.js";

export const PHOTO_DB_NAME = "food-log";
export const PHOTO_STORE_NAME = "photos";

const PROBE_KEY = "__food-log-probe__";

export function readEnvelope(storage = globalThis.localStorage) {
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { envelope: createEmptyEnvelope(), status: "unavailable" };
  }
  if (!raw) return { envelope: createEmptyEnvelope(), status: "empty" };
  try {
    const normalized = normalizeEnvelope(JSON.parse(raw));
    if (!normalized) return { envelope: createEmptyEnvelope(), status: "invalid" };
    return { envelope: normalized, status: "ok" };
  } catch {
    return { envelope: createEmptyEnvelope(), status: "invalid" };
  }
}

export function persistEnvelope(envelope, storage = globalThis.localStorage, now = new Date()) {
  const stamped = {
    app_id: envelope.app_id,
    schema_version: envelope.schema_version,
    saved_at: now instanceof Date ? now.toISOString() : String(now),
    data: envelope.data,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(stamped));
    return { ok: true, envelope: stamped };
  } catch (err) {
    const quota = err && (
      err.name === "QuotaExceededError"
      || err.name === "NS_ERROR_DOM_QUOTA_REACHED"
      || err.code === 22
    );
    return { ok: false, error: quota ? "quota" : "storage" };
  }
}

export function createPhotoKv(store = createStore(PHOTO_DB_NAME, PHOTO_STORE_NAME)) {
  return {
    get(key) { return get(key, store); },
    set(key, value) { return set(key, value, store); },
    del(key) { return del(key, store); },
  };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function openPhotoStore() {
  try {
    if (!globalThis.indexedDB) return null;
    const photos = createPhotoKv();
    await withTimeout(photos.get(PROBE_KEY), 4000);
    return photos;
  } catch {
    return null;
  }
}

export function dataUrlToBlob(dataUrl) {
  const trimmed = String(dataUrl).trim();
  const comma = trimmed.indexOf(",");
  if (!trimmed.startsWith("data:") || comma < 0) throw new Error("bad_data_url");
  const header = trimmed.slice(5, comma);
  const payload = trimmed.slice(comma + 1);
  const parts = header.split(";");
  const type = parts[0] || "application/octet-stream";
  const isBase64 = parts.some((part) => part.toLowerCase() === "base64");
  let bytes;
  if (isBase64) {
    const binary = atob(payload.replace(/\s+/g, ""));
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
  } else {
    const decoded = decodeURIComponent(payload);
    bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i) & 0xff;
  }
  return new Blob([bytes], { type });
}

export function blobMatches(stored, expected) {
  if (!stored || !expected) return false;
  if (typeof stored.size !== "number" || typeof expected.size !== "number") return false;
  if (stored.size !== expected.size) return false;
  return String(stored.type || "") === String(expected.type || "");
}

async function storeDataUrl(entry, photos) {
  if (!entry?.id || !isImageDataUrl(entry.image_data_url)) return false;
  let blob;
  try {
    blob = dataUrlToBlob(entry.image_data_url);
  } catch {
    return false;
  }
  const key = isImageKey(entry.image_key) ? entry.image_key : imageKeyFor(entry.id);
  try {
    await photos.set(key, blob);
    const stored = await photos.get(key);
    if (!blobMatches(stored, blob)) return false;
  } catch {
    return false;
  }
  entry.image_key = key;
  delete entry.image_data_url;
  return true;
}

function hasDataUrl(entry) {
  return isImageDataUrl(entry?.image_data_url);
}

export async function migrateEnvelope(envelope, options = {}) {
  const storage = options.storage || globalThis.localStorage;
  const photos = options.photos ?? null;
  const now = options.now || new Date();
  const next = structuredClone(envelope);
  let moved = 0;
  if (photos && Array.isArray(next.data?.entries)) {
    for (const entry of next.data.entries) {
      if (!hasDataUrl(entry)) continue;
      const dataUrl = entry.image_data_url;
      const previousKey = isImageKey(entry.image_key) ? entry.image_key : null;
      const stored = await storeDataUrl(entry, photos);
      if (!stored) continue;
      const saved = persistEnvelope(next, storage, now);
      if (!saved.ok) {
        entry.image_data_url = dataUrl;
        if (previousKey) entry.image_key = previousKey;
        else delete entry.image_key;
        return { ok: false, envelope: next, error: saved.error, moved };
      }
      next.saved_at = saved.envelope.saved_at;
      moved += 1;
    }
  }
  const leftover = (next.data?.entries || []).some((entry) => hasDataUrl(entry));
  if (!leftover && next.schema_version !== SCHEMA_VERSION) {
    next.schema_version = SCHEMA_VERSION;
    const saved = persistEnvelope(next, storage, now);
    if (!saved.ok) return { ok: false, envelope: next, error: saved.error, moved };
    return { ok: true, envelope: saved.envelope, moved };
  }
  return { ok: true, envelope: next, moved };
}

export async function placeOriginalPhoto(file, id, options = {}) {
  const photos = options.photos ?? null;
  const readFile = options.readFile || readOriginalImageFile;
  if (!file || !id) return { ok: false, error: "bad_image" };
  const key = imageKeyFor(id);
  if (photos) {
    try {
      await photos.set(key, file);
      const stored = await photos.get(key);
      if (blobMatches(stored, file)) return { ok: true, image_key: key };
    } catch {
      // IndexedDB rejected the write. Fall back to a data URL.
    }
    try { await photos.del(key); } catch { /* ignore */ }
  }
  try {
    const imageDataUrl = await readFile(file);
    if (!isImageDataUrl(imageDataUrl)) return { ok: false, error: "bad_image" };
    return { ok: true, image_data_url: imageDataUrl };
  } catch {
    return { ok: false, error: "read" };
  }
}

let persistAttempted = false;

export async function requestPersistentStorage(nav = globalThis.navigator) {
  if (persistAttempted) return null;
  persistAttempted = true;
  try {
    if (!nav?.storage?.persist) return null;
    return await nav.storage.persist();
  } catch {
    return null;
  }
}
