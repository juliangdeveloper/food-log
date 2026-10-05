import {
  APP_ID,
  DEFAULT_MEALS_FILE_ID,
  DEFAULT_OVERRIDES_FILE_ID,
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
} from "./config.js";

export const MEAL_TYPES = ["desayuno", "almuerzo", "cena", "snack", "otro"];

export const MEAL_LABELS = {
  desayuno: "Desayuno",
  almuerzo: "Almuerzo",
  cena: "Cena",
  snack: "Snack",
  otro: "Otro",
};

const IMAGE_RE = /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i;

export function isImageDataUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 32 && IMAGE_RE.test(trimmed);
}

export function imageKeyFor(id) {
  return `img:${id}`;
}

export function isImageKey(value) {
  return typeof value === "string" && value.startsWith("img:") && value.length > 4;
}

function toIso(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "string" && !Number.isNaN(Date.parse(now))) return now;
  return new Date().toISOString();
}

export function createEmptyEnvelope(now = new Date()) {
  return {
    app_id: APP_ID,
    schema_version: SCHEMA_VERSION,
    saved_at: toIso(now),
    data: {
      entries: [],
      nutrition: { overrides_file_id: DEFAULT_OVERRIDES_FILE_ID },
      meals: { file_id: DEFAULT_MEALS_FILE_ID },
      settings: {},
    },
  };
}

export function parseKcal(value) {
  if (value == null) return { ok: true, kcal: null };
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: "bad_kcal" };
    return { ok: true, kcal: value };
  }
  const raw = String(value).trim();
  if (!raw) return { ok: true, kcal: null };
  const normalized = raw.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { ok: false, error: "bad_kcal" };
  return { ok: true, kcal: Number(normalized) };
}

export function parseHunger(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

export function parseMealType(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return MEAL_TYPES.includes(v) ? v : null;
}

export function parseFileId(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const fromPath = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fromPath) return fromPath[1];
  const fromQuery = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (fromQuery) return fromQuery[1];
  return raw;
}

export function buildEntry(input, now = new Date()) {
  const description = String(input?.description ?? "").trim();
  const image = String(input?.image_data_url ?? "").trim() || null;
  const imageKey = isImageKey(input?.image_key) ? input.image_key : null;
  if (image && !isImageDataUrl(image)) return { ok: false, error: "bad_image" };
  if (input?.image_key != null && input.image_key !== "" && !imageKey) {
    return { ok: false, error: "bad_image" };
  }
  const hasImage = Boolean(image || imageKey || input?.has_image);
  if (!hasImage && !description) return { ok: false, error: "need_content" };
  const kcalParsed = parseKcal(input?.kcal);
  if (!kcalParsed.ok) return { ok: false, error: "bad_kcal" };
  const iso = toIso(now);
  const entry = {
    id: typeof input?.id === "string" && input.id
      ? input.id
      : (globalThis.crypto?.randomUUID?.() || `entry-${iso}`),
    created_at: iso,
    updated_at: iso,
    meal_type: parseMealType(input?.meal_type),
    description,
    portion: String(input?.portion ?? "").trim(),
    hunger: parseHunger(input?.hunger),
    notes: String(input?.notes ?? "").trim(),
    kcal: kcalParsed.kcal,
  };
  if (imageKey) entry.image_key = imageKey;
  if (image) entry.image_data_url = image;
  else if (!imageKey) entry.image_data_url = null;
  return { ok: true, entry };
}

export function isSameLocalDay(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const n = now instanceof Date ? now : new Date(now);
  return d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate();
}

export function entriesForLocalDay(entries, now = new Date()) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && isSameLocalDay(entry.created_at, now))
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const image = isImageDataUrl(raw.image_data_url) ? raw.image_data_url.trim() : null;
  const imageKey = isImageKey(raw.image_key) ? raw.image_key : null;
  if (!image && !imageKey && !description) return null;
  const kcalParsed = parseKcal(raw.kcal);
  const created = typeof raw.created_at === "string" && !Number.isNaN(Date.parse(raw.created_at))
    ? raw.created_at
    : new Date().toISOString();
  const updated = typeof raw.updated_at === "string" && !Number.isNaN(Date.parse(raw.updated_at))
    ? raw.updated_at
    : created;
  const entry = {
    id: typeof raw.id === "string" && raw.id
      ? raw.id
      : (globalThis.crypto?.randomUUID?.() || `entry-${created}`),
    created_at: created,
    updated_at: updated,
    meal_type: parseMealType(raw.meal_type),
    description,
    portion: typeof raw.portion === "string" ? raw.portion.trim() : "",
    hunger: parseHunger(raw.hunger),
    notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    kcal: kcalParsed.ok ? kcalParsed.kcal : null,
  };
  if (imageKey) entry.image_key = imageKey;
  if (image) entry.image_data_url = image;
  else if (!imageKey) entry.image_data_url = null;
  return entry;
}

export function normalizeEnvelope(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.app_id !== APP_ID) return null;
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(raw.schema_version)) return null;
  if (!raw.data || typeof raw.data !== "object" || Array.isArray(raw.data)) return null;
  if (!Array.isArray(raw.data.entries)) return null;
  const nutrition = raw.data.nutrition;
  if (!nutrition || typeof nutrition !== "object" || Array.isArray(nutrition)) return null;
  let fileId = null;
  if (Object.prototype.hasOwnProperty.call(nutrition, "overrides_file_id")) {
    fileId = nutrition.overrides_file_id;
  }
  if (fileId == null || fileId === "") fileId = null;
  else if (typeof fileId !== "string") return null;
  const mealsFileId = normalizeMealsFileId(raw.data.meals);
  if (!mealsFileId.ok) return null;
  const settings = raw.data.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const savedAt = typeof raw.saved_at === "string" && !Number.isNaN(Date.parse(raw.saved_at))
    ? raw.saved_at
    : new Date().toISOString();
  return {
    app_id: APP_ID,
    schema_version: raw.schema_version,
    saved_at: savedAt,
    data: {
      entries: raw.data.entries.map(normalizeEntry).filter(Boolean),
      nutrition: { overrides_file_id: fileId },
      meals: { file_id: mealsFileId.fileId },
      settings: { ...settings },
    },
  };
}

function normalizeMealsFileId(meals) {
  if (meals == null) return { ok: true, fileId: DEFAULT_MEALS_FILE_ID };
  if (typeof meals !== "object" || Array.isArray(meals)) return { ok: false };
  if (!Object.prototype.hasOwnProperty.call(meals, "file_id")) {
    return { ok: true, fileId: DEFAULT_MEALS_FILE_ID };
  }
  const fileId = meals.file_id;
  if (fileId == null || fileId === "") return { ok: true, fileId: null };
  if (typeof fileId !== "string") return { ok: false };
  return { ok: true, fileId };
}

export function importEnvelope(json) {
  let raw = json;
  if (typeof json === "string") {
    try {
      raw = JSON.parse(json);
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  }
  const envelope = normalizeEnvelope(raw);
  if (envelope) return { ok: true, envelope };
  if (raw && typeof raw === "object" && raw.app_id && raw.app_id !== APP_ID) {
    return { ok: false, error: "wrong_app" };
  }
  if (raw && typeof raw === "object" && raw.schema_version != null
    && !SUPPORTED_SCHEMA_VERSIONS.includes(raw.schema_version)) {
    return { ok: false, error: "wrong_version" };
  }
  return { ok: false, error: "invalid_envelope" };
}
