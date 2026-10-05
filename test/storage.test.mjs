import assert from "node:assert/strict";
import test from "node:test";
import { STORAGE_KEY } from "../js/config.js";
import { createEmptyEnvelope } from "../js/model.js";
import {
  PHOTO_DB_NAME,
  PHOTO_STORE_NAME,
  blobMatches,
  dataUrlToBlob,
  migrateEnvelope,
  placeOriginalPhoto,
  readEnvelope,
} from "../js/storage.js";

const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const NOW = new Date("2026-10-05T12:00:00.000Z");

function memoryStorage() {
  const map = new Map();
  let fail = false;
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      if (fail) {
        const err = new Error("quota");
        err.name = "QuotaExceededError";
        throw err;
      }
      map.set(key, String(value));
    },
    blockWrites() { fail = true; },
    allowWrites() { fail = false; },
  };
}

function memoryPhotos(hooks = {}) {
  const map = new Map();
  return {
    async get(key) {
      if (hooks.get) return hooks.get(key, map);
      return map.has(key) ? map.get(key) : undefined;
    },
    async set(key, value) {
      if (hooks.set) return hooks.set(key, value, map);
      const buf = await value.arrayBuffer();
      map.set(key, new Blob([buf], { type: value.type }));
    },
    async del(key) {
      map.delete(key);
    },
    map,
  };
}

function entry(id, extra = {}) {
  return {
    id,
    created_at: "2026-10-05T11:00:00.000Z",
    updated_at: "2026-10-05T11:00:00.000Z",
    meal_type: "almuerzo",
    description: extra.description ?? "",
    portion: "",
    hunger: null,
    notes: "",
    kcal: null,
    ...extra,
  };
}

function v1Envelope(entries) {
  return {
    app_id: "food-log",
    schema_version: 1,
    saved_at: "2026-10-05T11:00:00.000Z",
    data: {
      entries,
      nutrition: { overrides_file_id: "overrides-kept" },
      meals: { file_id: "meals-kept" },
      settings: { kept: true },
    },
  };
}

function gifBytes() {
  return Buffer.from(GIF.split(",")[1], "base64");
}

test("photo database names stay dedicated to food-log", () => {
  assert.equal(PHOTO_DB_NAME, "food-log");
  assert.equal(PHOTO_STORE_NAME, "photos");
});

test("migration moves each data URL to a blob and upgrades schema once", async () => {
  const storage = memoryStorage();
  const photos = memoryPhotos();
  const envelope = v1Envelope([
    entry("a", { image_data_url: GIF, description: "" }),
    entry("b", { description: "solo texto", image_data_url: null }),
  ]);
  storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  const read = readEnvelope(storage);
  assert.equal(read.status, "ok");
  assert.equal(read.envelope.schema_version, 1);

  const migrated = await migrateEnvelope(read.envelope, { storage, photos, now: NOW });
  assert.equal(migrated.ok, true);
  assert.equal(migrated.moved, 1);
  const saved = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(saved.schema_version, 2);
  assert.equal(saved.data.entries[0].image_key, "img:a");
  assert.equal(saved.data.entries[0].image_data_url, undefined);
  assert.equal(saved.data.entries[1].description, "solo texto");
  assert.equal(saved.data.entries[1].image_data_url, null);
  assert.equal(saved.data.nutrition.overrides_file_id, "overrides-kept");
  assert.equal(saved.data.meals.file_id, "meals-kept");
  assert.deepEqual(saved.data.settings, { kept: true });

  const blob = photos.map.get("img:a");
  assert.equal(blob.type, "image/gif");
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), gifBytes());

  let sets = 0;
  const againPhotos = {
    async get(key) { return photos.map.get(key); },
    async set() { sets += 1; },
    async del() {},
  };
  const again = await migrateEnvelope(readEnvelope(storage).envelope, {
    storage,
    photos: againPhotos,
    now: NOW,
  });
  assert.equal(again.moved, 0);
  assert.equal(again.envelope.schema_version, 2);
  assert.equal(sets, 0);
});

test("migration resumes after a partial failure without dropping the remaining data URL", async () => {
  const storage = memoryStorage();
  const envelope = v1Envelope([
    entry("a", { image_data_url: GIF }),
    entry("b", { image_data_url: GIF, description: "dos" }),
  ]);
  storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  let failB = true;
  const photos = memoryPhotos({
    async set(key, value, map) {
      if (key === "img:b" && failB) throw new Error("idb");
      const buf = await value.arrayBuffer();
      map.set(key, new Blob([buf], { type: value.type }));
    },
  });

  const first = await migrateEnvelope(readEnvelope(storage).envelope, { storage, photos, now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.moved, 1);
  const mid = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(mid.schema_version, 1);
  assert.equal(mid.data.entries[0].image_key, "img:a");
  assert.equal("image_data_url" in mid.data.entries[0], false);
  assert.equal(mid.data.entries[1].image_data_url, GIF);
  assert.equal(mid.data.entries[1].image_key, undefined);
  assert.equal(photos.map.has("img:b"), false);
  assert.deepEqual(Buffer.from(await photos.map.get("img:a").arrayBuffer()), gifBytes());

  failB = false;
  const second = await migrateEnvelope(readEnvelope(storage).envelope, { storage, photos, now: NOW });
  assert.equal(second.ok, true);
  assert.equal(second.moved, 1);
  const done = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(done.schema_version, 2);
  assert.equal(done.data.entries[0].image_key, "img:a");
  assert.equal(done.data.entries[1].image_key, "img:b");
  assert.equal(done.data.entries[1].image_data_url, undefined);
  assert.equal(done.data.entries[1].description, "dos");
  assert.deepEqual(Buffer.from(await photos.map.get("img:b").arrayBuffer()), gifBytes());
});

test("a data URL stays in localStorage when the IndexedDB write is not verified", async () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(v1Envelope([
    entry("a", { image_data_url: GIF, description: "foto" }),
  ])));
  const photos = memoryPhotos({
    async set(key, value, map) {
      map.set(key, value);
    },
    async get() {
      return new Blob([Uint8Array.of(1, 2, 3)], { type: "text/plain" });
    },
  });
  const result = await migrateEnvelope(readEnvelope(storage).envelope, { storage, photos, now: NOW });
  assert.equal(result.moved, 0);
  assert.equal(result.envelope.schema_version, 1);
  assert.equal(result.envelope.data.entries[0].image_data_url, GIF);
  assert.equal(result.envelope.data.entries[0].image_key, undefined);
  const raw = storage.getItem(STORAGE_KEY);
  assert.match(raw, /image_data_url/);
  assert.equal(JSON.parse(raw).schema_version, 1);
  assert.equal(JSON.parse(raw).data.entries[0].image_data_url, GIF);
});

test("a failed envelope write rolls the data URL back and leaves localStorage unchanged", async () => {
  const storage = memoryStorage();
  const original = v1Envelope([entry("a", { image_data_url: GIF })]);
  storage.setItem(STORAGE_KEY, JSON.stringify(original));
  storage.blockWrites();
  const photos = memoryPhotos();
  const result = await migrateEnvelope(readEnvelope(storage).envelope, { storage, photos, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.error, "quota");
  assert.equal(result.moved, 0);
  assert.equal(result.envelope.data.entries[0].image_data_url, GIF);
  assert.equal(result.envelope.schema_version, 1);
  assert.equal(storage.getItem(STORAGE_KEY), JSON.stringify(original));
  assert.equal(blobMatches(photos.map.get("img:a"), dataUrlToBlob(GIF)), true);
});

test("without IndexedDB, data URLs stay and schema 2 is not forced over them", async () => {
  const storage = memoryStorage();
  const original = v1Envelope([
    entry("a", { image_data_url: GIF, description: "foto" }),
  ]);
  storage.setItem(STORAGE_KEY, JSON.stringify(original));
  const result = await migrateEnvelope(readEnvelope(storage).envelope, {
    storage,
    photos: null,
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.moved, 0);
  assert.equal(result.envelope.schema_version, 1);
  assert.equal(result.envelope.data.entries[0].image_data_url, GIF);
  assert.equal(storage.getItem(STORAGE_KEY), JSON.stringify(original));
});

test("a text-only schema 1 envelope upgrades without a photo store", async () => {
  const storage = memoryStorage();
  const envelope = v1Envelope([entry("a", { description: "arepa", image_data_url: null })]);
  storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  const result = await migrateEnvelope(readEnvelope(storage).envelope, {
    storage,
    photos: null,
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.envelope.schema_version, 2);
  assert.equal(result.envelope.data.entries[0].description, "arepa");
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).schema_version, 2);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).data.meals.file_id, "meals-kept");
});

test("reading accepts an image_key entry and a legacy data URL together", () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(v1Envelope([
    entry("keyed", { image_key: "img:keyed", description: "" }),
    entry("legacy", { image_data_url: GIF, image_key: "img:legacy", description: "ambos" }),
  ])));
  const read = readEnvelope(storage);
  assert.equal(read.status, "ok");
  assert.equal(read.envelope.schema_version, 1);
  assert.equal(read.envelope.data.entries[0].image_key, "img:keyed");
  assert.equal(read.envelope.data.entries[0].image_data_url, undefined);
  assert.equal(read.envelope.data.entries[1].image_data_url, GIF);
  assert.equal(read.envelope.data.entries[1].image_key, "img:legacy");
});

test("a new photo is stored as the original blob, or as a data URL if IndexedDB fails", async () => {
  const bytes = Uint8Array.of(1, 2, 3, 4, 5);
  const file = new Blob([bytes], { type: "image/png" });
  const photos = memoryPhotos();
  const placed = await placeOriginalPhoto(file, "abc", {
    photos,
    readFile: async () => {
      throw new Error("should not encode");
    },
  });
  assert.deepEqual(placed, { ok: true, image_key: "img:abc" });
  assert.deepEqual(Buffer.from(await photos.map.get("img:abc").arrayBuffer()), Buffer.from(bytes));
  assert.equal(photos.map.get("img:abc").type, "image/png");

  const deleted = [];
  const failing = {
    async set() { throw new Error("private"); },
    async get() { throw new Error("private"); },
    async del(key) { deleted.push(key); },
  };
  const fallback = await placeOriginalPhoto(file, "abc", {
    photos: failing,
    readFile: async (blob) => {
      assert.equal(blob, file);
      return GIF;
    },
  });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.image_data_url, GIF);
  assert.equal(fallback.image_key, undefined);

  const mismatched = memoryPhotos({
    async get() {
      return new Blob([Uint8Array.of(9)], { type: "image/png" });
    },
  });
  const unverified = await placeOriginalPhoto(file, "abc", {
    photos: mismatched,
    readFile: async () => GIF,
  });
  assert.equal(unverified.image_data_url, GIF);
  assert.equal(unverified.image_key, undefined);
  assert.equal(mismatched.map.has("img:abc"), false);
});

test("fresh envelopes are schema 2 and still round-trip through localStorage", () => {
  const storage = memoryStorage();
  const fresh = createEmptyEnvelope(NOW);
  assert.equal(fresh.schema_version, 2);
  const read = readEnvelope(storage);
  assert.equal(read.status, "empty");
  assert.equal(read.envelope.schema_version, 2);
});
