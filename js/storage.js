import { STORAGE_KEY } from "./config.js";
import { createEmptyEnvelope, normalizeEnvelope } from "./model.js";

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
