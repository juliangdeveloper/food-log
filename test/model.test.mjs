import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_ID,
  DEFAULT_MEALS_FILE_ID,
  DEFAULT_OVERRIDES_FILE_ID,
  GOOGLE_CLIENT_ID,
  STORAGE_KEY,
} from "../js/config.js";
import {
  buildEntry,
  createEmptyEnvelope,
  entriesForLocalDay,
  importEnvelope,
  parseFileId,
} from "../js/model.js";
import { persistEnvelope, readEnvelope } from "../js/storage.js";

const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function memoryStorage(options = {}) {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      if (options.quota) {
        const err = new Error("quota");
        err.name = "QuotaExceededError";
        throw err;
      }
      map.set(key, String(value));
    },
  };
}

test("fresh envelope matches the shared shape and seeds the sheet id", () => {
  const now = new Date("2026-10-02T15:04:05.000Z");
  const envelope = createEmptyEnvelope(now);
  assert.equal(envelope.app_id, "food-log");
  assert.equal(APP_ID, "food-log");
  assert.equal(envelope.schema_version, 1);
  assert.equal(envelope.saved_at, "2026-10-02T15:04:05.000Z");
  assert.deepEqual(envelope.data.entries, []);
  assert.equal(envelope.data.nutrition.overrides_file_id, DEFAULT_OVERRIDES_FILE_ID);
  assert.equal(envelope.data.nutrition.overrides_file_id, "1B7WyOstF7xqgAgSS_7u46aFyGOFLYCtUm4O2Nw8xcKo");
  assert.equal(envelope.data.meals.file_id, DEFAULT_MEALS_FILE_ID);
  assert.equal(envelope.data.meals.file_id, "1YQC6LvXllCqRzUpNJ3guYn1GXcHI3Ra6y6LtgPCZlD0");
  assert.deepEqual(envelope.data.settings, {});
  assert.equal(GOOGLE_CLIENT_ID, "");
  assert.equal(STORAGE_KEY, "food-log.save.v1");
});

test("image-only and text-only entries are valid; empty is not", () => {
  const now = new Date("2026-10-02T12:00:00.000Z");
  const photo = buildEntry({ image_data_url: GIF, description: "   " }, now);
  assert.equal(photo.ok, true);
  assert.equal(photo.entry.description, "");
  assert.equal(photo.entry.image_data_url, GIF);
  assert.equal(photo.entry.meal_type, null);
  assert.equal(photo.entry.hunger, null);
  assert.equal(photo.entry.kcal, null);

  const text = buildEntry({
    description: "  Bandeja paisa ",
    portion: " 1 plato ",
    notes: " sin aguacate ",
    kcal: "850,5",
    meal_type: "Almuerzo",
    hunger: "4",
  }, now);
  assert.equal(text.ok, true);
  assert.equal(text.entry.image_data_url, null);
  assert.equal(text.entry.description, "Bandeja paisa");
  assert.equal(text.entry.portion, "1 plato");
  assert.equal(text.entry.notes, "sin aguacate");
  assert.equal(text.entry.kcal, 850.5);
  assert.equal(text.entry.meal_type, "almuerzo");
  assert.equal(text.entry.hunger, 4);
  assert.equal(text.entry.created_at, text.entry.updated_at);

  assert.equal(buildEntry({ description: "   ", kcal: "10" }).ok, false);
  assert.equal(buildEntry({ description: "sopa", kcal: "no sé" }).error, "bad_kcal");
  assert.equal(buildEntry({ description: "sopa", hunger: 9 }).entry.hunger, null);
});

test("today list uses the local calendar day", () => {
  const now = new Date(2026, 9, 2, 21, 0, 0);
  const today = new Date(2026, 9, 2, 8, 15, 0).toISOString();
  const yesterday = new Date(2026, 9, 1, 23, 50, 0).toISOString();
  const entries = entriesForLocalDay([
    { created_at: yesterday, description: "ayer" },
    { created_at: today, description: "hoy" },
  ], now);
  assert.deepEqual(entries.map((entry) => entry.description), ["hoy"]);
});

test("file id parser accepts a raw id or a docs url and clear stays null", () => {
  const id = "1B7WyOstF7xqgAgSS_7u46aFyGOFLYCtUm4O2Nw8xcKo";
  assert.equal(parseFileId(`https://docs.google.com/spreadsheets/d/${id}/edit`), id);
  assert.equal(parseFileId(id), id);
  assert.equal(parseFileId("   "), null);
  const cleared = createEmptyEnvelope();
  cleared.data.nutrition.overrides_file_id = null;
  cleared.data.meals.file_id = null;
  const imported = importEnvelope(cleared).envelope;
  assert.equal(imported.data.nutrition.overrides_file_id, null);
  assert.equal(imported.data.meals.file_id, null);
});

test("older saves without data.meals keep entries and gain the default meals file id", () => {
  const now = new Date("2026-10-02T12:00:00.000Z");
  const entry = buildEntry({ description: "arepa", meal_type: "desayuno" }, now).entry;
  const legacy = {
    app_id: "food-log",
    schema_version: 1,
    saved_at: "2026-10-02T12:00:00.000Z",
    data: {
      entries: [entry],
      nutrition: { overrides_file_id: null },
      settings: { kept: true },
    },
  };
  const imported = importEnvelope(legacy);
  assert.equal(imported.ok, true);
  assert.equal(imported.envelope.data.entries.length, 1);
  assert.equal(imported.envelope.data.entries[0].id, entry.id);
  assert.equal(imported.envelope.data.entries[0].description, "arepa");
  assert.equal(imported.envelope.data.meals.file_id, DEFAULT_MEALS_FILE_ID);
  assert.equal(imported.envelope.data.nutrition.overrides_file_id, null);
  assert.deepEqual(imported.envelope.data.settings, { kept: true });

  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));
  const read = readEnvelope(storage);
  assert.equal(read.status, "ok");
  assert.equal(read.envelope.data.entries[0].description, "arepa");
  assert.equal(read.envelope.data.meals.file_id, DEFAULT_MEALS_FILE_ID);

  const cleared = createEmptyEnvelope();
  cleared.data.meals.file_id = null;
  const saved = persistEnvelope(cleared, memoryStorage(), now);
  assert.equal(saved.ok, true);
  assert.equal(importEnvelope(saved.envelope).envelope.data.meals.file_id, null);
  assert.equal(importEnvelope({ ...legacy, data: { ...legacy.data, meals: { file_id: 12 } } }).error, "invalid_envelope");
});

test("import rejects the wrong app and persists the envelope under the save key", () => {
  assert.equal(importEnvelope("{").error, "invalid_json");
  assert.equal(importEnvelope(JSON.stringify({ app_id: "other", schema_version: 1 })).error, "wrong_app");
  assert.equal(importEnvelope(JSON.stringify({
    app_id: "food-log",
    schema_version: 2,
    data: { entries: [], nutrition: { overrides_file_id: null }, settings: {} },
  })).error, "wrong_version");

  const storage = memoryStorage();
  const fresh = readEnvelope(storage);
  assert.equal(fresh.status, "empty");
  const saved = persistEnvelope(fresh.envelope, storage, new Date("2026-10-02T00:00:00.000Z"));
  assert.equal(saved.ok, true);
  const roundtrip = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(roundtrip.app_id, "food-log");
  assert.equal(roundtrip.schema_version, 1);
  assert.equal(roundtrip.data.nutrition.overrides_file_id, DEFAULT_OVERRIDES_FILE_ID);
  assert.equal(roundtrip.data.meals.file_id, DEFAULT_MEALS_FILE_ID);
  assert.equal(readEnvelope(storage).status, "ok");
  assert.equal(persistEnvelope(fresh.envelope, memoryStorage({ quota: true })).error, "quota");
});
