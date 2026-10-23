import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { APP_VERSION, STORAGE_KEY } from "../js/config.js";
import { metaStorageKey, metaUpdate } from "../js/meta.js";
import {
  ACHIEVEMENTS,
  STATS,
  achievementIdsFor,
  backfillProgress,
  flushProgress,
  progressStats,
  syncProgress,
} from "../js/progress.js";
import { readEnvelope } from "../js/storage.js";

const KEY = metaStorageKey("food-log");
const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      writes.push(key);
      map.set(key, String(value));
    },
    keys() { return [...map.keys()]; },
  };
}

function freshClock(nowMs) {
  const clock = { lastWriteAt: null };
  if (nowMs != null) clock.nowMs = nowMs;
  return clock;
}

function atLocal(year, month, day, hour = 12) {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

function entry(iso, extra = {}) {
  return {
    id: extra.id || "entry-local",
    created_at: iso,
    updated_at: iso,
    meal_type: "almuerzo",
    description: extra.description || "",
    portion: extra.portion || "",
    hunger: null,
    notes: extra.notes || "",
    kcal: extra.kcal ?? null,
    ...(extra.image_key ? { image_key: extra.image_key } : {}),
    ...(extra.image_data_url ? { image_data_url: extra.image_data_url } : { image_data_url: null }),
  };
}

function envelope(entries) {
  return {
    app_id: "food-log",
    schema_version: 2,
    saved_at: "2026-10-21T18:00:00.000Z",
    data: {
      entries,
      nutrition: { overrides_file_id: "file-token" },
      meals: { file_id: "sheet-token" },
      settings: { note: "TOKEN_SETTING" },
    },
  };
}

test("an old save without the meta key backfills counts and achievements", () => {
  const now = atLocal(2026, 10, 21, 18);
  const day1 = atLocal(2026, 10, 20, 13).toISOString();
  const day2 = atLocal(2026, 10, 21, 13).toISOString();
  const saved = envelope([
    entry(day1, {
      id: "entry-photo",
      description: "TOKEN_FOOD",
      portion: "TOKEN_PORTION",
      notes: "TOKEN_NOTE",
      kcal: 987654,
      image_key: "img:token-photo",
    }),
    entry(day2, { id: "entry-text", description: "TOKEN_FOOD_2" }),
    entry(day2, {
      id: "entry-gif",
      description: "",
      image_data_url: GIF,
    }),
  ]);
  const rawSave = JSON.stringify(saved);
  const storage = memoryStorage({
    [STORAGE_KEY]: rawSave,
    "other.setting": "keep-me",
  });
  const read = readEnvelope(storage);
  assert.equal(read.status, "ok");
  const record = backfillProgress(read.envelope, { storage, now, clock: freshClock() });
  const stored = JSON.parse(storage.getItem(KEY));

  assert.equal(storage.getItem(STORAGE_KEY), rawSave);
  assert.equal(storage.getItem("other.setting"), "keep-me");
  assert.deepEqual(record, stored);
  assert.equal(record.v, 1);
  assert.equal(record.slug, "food-log");
  assert.equal(record.version, APP_VERSION);
  assert.equal(record.version.startsWith("v"), false);
  assert.deepEqual(Object.keys(record.stats), STATS.map((item) => item.key));
  assert.equal(record.updatedAt, now.toISOString());
  assert.deepEqual(record.stats, {
    days_logged: 2,
    entries_total: 3,
    photo_entries: 2,
    current_streak_days: 2,
    best_streak_days: 2,
  });
  assert.deepEqual(record.logros, ["first_entry", "first_photo"]);
  assert.deepEqual(record.hitos, {
    first_entry: now.toISOString(),
    first_photo: now.toISOString(),
  });

  const serialized = storage.getItem(KEY);
  for (const secret of [day1, day2, "TOKEN_FOOD", "TOKEN_PORTION", "TOKEN_NOTE", "987654", "file-token", "sheet-token", "TOKEN_SETTING", "entry-photo", "img:token-photo", "R0lGODlh"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("backfill with no local history starts at zero", () => {
  const now = new Date("2026-10-23T18:00:00.000Z");
  const storage = memoryStorage();
  const record = backfillProgress({ data: { entries: [] } }, { storage, now, clock: freshClock() });
  assert.deepEqual(record.stats, {
    days_logged: 0,
    entries_total: 0,
    photo_entries: 0,
    current_streak_days: 0,
    best_streak_days: 0,
  });
  assert.deepEqual(record.logros, []);
  assert.deepEqual(record.hitos, {});
  assert.equal(record.version, APP_VERSION);
  assert.deepEqual(storage.keys(), [KEY]);
});

test("backfill does not overwrite an existing meta record", () => {
  const existing = {
    v: 1,
    slug: "food-log",
    version: "0.2.1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stats: {
      days_logged: 4,
      entries_total: 9,
      photo_entries: 2,
      current_streak_days: 1,
      best_streak_days: 4,
    },
    logros: ["first_entry"],
    hitos: { first_entry: "2026-01-01T00:00:00.000Z" },
  };
  const rawMeta = JSON.stringify(existing);
  const rawSave = JSON.stringify(envelope([
    entry("2026-10-21T15:00:00.000Z", { id: "entry-later", description: "TOKEN_FOOD" }),
  ]));
  const storage = memoryStorage({
    [KEY]: rawMeta,
    [STORAGE_KEY]: rawSave,
  });
  let posts = 0;
  const view = {
    location: { origin: "https://portfolio.test" },
    parent: { postMessage() { posts += 1; } },
  };
  const record = backfillProgress(envelope([
    entry("2026-10-21T15:00:00.000Z", { description: "TOKEN_FOOD", image_key: "img:later" }),
  ]), { storage, now: new Date("2026-10-23T18:00:00.000Z"), window: view, clock: freshClock() });

  assert.equal(storage.getItem(KEY), rawMeta);
  assert.equal(storage.getItem(`${KEY}.corrupt`), null);
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.getItem(STORAGE_KEY), rawSave);
  assert.equal(record.version, "0.2.1");
  assert.equal(record.stats.entries_total, 9);
  assert.equal(record.hitos.first_entry, "2026-01-01T00:00:00.000Z");
  assert.equal(posts, 0);
});

test("a corrupt meta record is copied aside and rebuilt from the save", () => {
  const now = new Date("2026-10-23T18:00:00.000Z");
  const rawSave = JSON.stringify(envelope([
    entry("2026-10-21T15:00:00.000Z", { id: "entry-kept", description: "TOKEN_FOOD", image_data_url: GIF }),
  ]));
  const broken = [
    "{not json",
    "[]",
    "null",
    JSON.stringify({ v: 2, slug: "food-log", hitos: { first_entry: "2020-01-01T00:00:00.000Z" } }),
    JSON.stringify({ v: 1, slug: "other-app", stats: { entries_total: 99 } }),
  ];
  for (const raw of broken) {
    const storage = memoryStorage({
      [KEY]: raw,
      [STORAGE_KEY]: rawSave,
      "other.setting": "keep-me",
    });
    let record;
    assert.doesNotThrow(() => {
      record = backfillProgress(JSON.parse(rawSave), {
        storage,
        now,
        clock: freshClock(),
      });
    });
    assert.equal(storage.getItem(`${KEY}.corrupt`), raw);
    assert.equal(storage.getItem(STORAGE_KEY), rawSave);
    assert.equal(storage.getItem("other.setting"), "keep-me");
    assert.equal(storage.writes.includes(STORAGE_KEY), false);
    assert.equal(record.v, 1);
    assert.equal(record.slug, "food-log");
    assert.equal(record.version, APP_VERSION);
    assert.equal(record.stats.entries_total, 1);
    assert.equal(record.stats.photo_entries, 1);
    assert.deepEqual(record.logros, ["first_entry", "first_photo"]);
    assert.equal(record.hitos.first_entry, now.toISOString());
    assert.equal(record.hitos.first_photo, now.toISOString());
    assert.equal(storage.getItem(KEY).includes("TOKEN_FOOD"), false);
    assert.equal(storage.getItem(KEY).includes("R0lGODlh"), false);
  }
});

test("metaUpdate keeps hitos, drops non-finite and undeclared stats, and strips a leading v", () => {
  const storage = memoryStorage({ [KEY]: "{not json" });
  const clock = freshClock(1_000);
  const firstAt = new Date("2026-10-20T15:01:02.000Z");
  const messages = [];
  const view = {
    location: { origin: "https://portfolio.test" },
    parent: {
      postMessage(message, origin) { messages.push({ message, origin }); },
    },
  };
  const deps = { storage, declared: STATS, clock, window: view };
  const first = metaUpdate("food-log", `v${APP_VERSION}`, {
    stats: { entries_total: 1, photo_entries: Number.NaN, days_logged: Infinity, label: "nope" },
    logros: ["first_entry", "first_entry", "Not An Id"],
  }, { ...deps, now: firstAt });

  assert.equal(first.version, APP_VERSION);
  assert.deepEqual(first.stats, { entries_total: 1 });
  assert.deepEqual(first.logros, ["first_entry"]);
  assert.equal(first.hitos.first_entry, firstAt.toISOString());
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].message, { type: "meta", key: KEY, data: first });
  assert.equal(messages[0].origin, "https://portfolio.test");

  clock.nowMs += 1000;
  const later = new Date("2026-10-23T18:00:00.000Z");
  const second = metaUpdate("food-log", APP_VERSION, {
    stats: { entries_total: 10, photo_entries: 1, days_logged: 3, current_streak_days: 1, best_streak_days: 3 },
    logros: ["entries_10", "first_photo"],
  }, { ...deps, now: later });

  assert.equal(second.hitos.first_entry, firstAt.toISOString());
  assert.equal(second.hitos.entries_10, later.toISOString());
  assert.equal(second.hitos.first_photo, later.toISOString());
  assert.deepEqual(second.logros, ["entries_10", "first_entry", "first_photo"]);
  assert.deepEqual(second.stats, {
    days_logged: 3,
    entries_total: 10,
    photo_entries: 1,
    current_streak_days: 1,
    best_streak_days: 3,
  });
  assert.equal(second.updatedAt, later.toISOString());
  assert.equal(second.v, 1);
  assert.equal(second.slug, "food-log");
  assert.equal(messages.length, 2);

  clock.nowMs += 1000;
  const sameWindow = { location: { origin: "https://portfolio.test" } };
  sameWindow.parent = sameWindow;
  metaUpdate("food-log", APP_VERSION, { stats: { entries_total: 10 }, logros: [] }, {
    ...deps,
    now: later,
    window: sameWindow,
  });
  assert.equal(messages.length, 2);
});

test("backfill, a later save, and flush write the meta key at most once per second", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const storage = memoryStorage();
    const clock = freshClock();
    const posts = [];
    const view = {
      location: { origin: "https://portfolio.test" },
      parent: { postMessage(message) { posts.push(message); } },
    };
    const meal = (id) => entry("2026-10-23T12:00:00.000Z", { id, description: "TOKEN_FOOD" });
    backfillProgress({ data: { entries: [] } }, { storage, clock, window: view, now: new Date("2026-10-23T18:00:00.000Z") });
    syncProgress({ data: { entries: [meal("a")] } }, { storage, clock, window: view });
    syncProgress({ data: { entries: [meal("a"), meal("b")] } }, { storage, clock, window: view });
    flushProgress();
    assert.deepEqual(storage.writes, [KEY]);
    assert.equal(posts.length, 1);
    assert.equal(JSON.parse(storage.getItem(KEY)).stats.entries_total, 0);
    mock.timers.tick(999);
    flushProgress();
    assert.deepEqual(storage.writes, [KEY]);
    assert.equal(posts.length, 1);
    mock.timers.tick(1);
    assert.deepEqual(storage.writes, [KEY, KEY]);
    assert.equal(posts.length, 2);
    assert.equal(JSON.parse(storage.getItem(KEY)).stats.entries_total, 2);
    assert.equal(storage.getItem(KEY).includes("TOKEN_FOOD"), false);
    flushProgress();
    assert.deepEqual(storage.writes, [KEY, KEY]);
    assert.equal(posts.length, 2);
  } finally {
    mock.timers.reset();
  }
});

test("syncProgress records the current counts on the first call", () => {
  const storage = memoryStorage();
  const now = atLocal(2026, 10, 23, 12);
  syncProgress({
    data: {
      entries: [
        entry(now.toISOString(), { image_data_url: GIF, description: "TOKEN_FOOD" }),
      ],
    },
  }, { storage, now, clock: freshClock() });
  const record = JSON.parse(storage.getItem(KEY));
  assert.equal(record.stats.entries_total, 1);
  assert.equal(record.stats.photo_entries, 1);
  assert.deepEqual(record.logros, ["first_entry", "first_photo"]);
  assert.equal(storage.getItem(KEY).includes("TOKEN_FOOD"), false);
});

test("streaks use local days, and achievements follow the count thresholds", () => {
  const today = atLocal(2026, 10, 23, 12);
  const iso = (day) => atLocal(2026, 10, day, 12).toISOString();
  const active = progressStats([20, 21, 22, 23].map((day) => ({ created_at: iso(day) })), today);
  assert.equal(active.days_logged, 4);
  assert.equal(active.current_streak_days, 4);
  assert.equal(active.best_streak_days, 4);

  const throughYesterday = progressStats([20, 21, 22].map((day) => ({ created_at: iso(day) })), today);
  assert.equal(throughYesterday.current_streak_days, 3);
  assert.equal(throughYesterday.best_streak_days, 3);

  const broken = progressStats([20, 21].map((day) => ({ created_at: iso(day) })), today);
  assert.equal(broken.current_streak_days, 0);
  assert.equal(broken.best_streak_days, 2);

  const ids = new Set(ACHIEVEMENTS.map((item) => item.id));
  assert.equal(ids.size, ACHIEVEMENTS.length);
  assert.ok(ACHIEVEMENTS.length >= 5 && ACHIEVEMENTS.length <= 12);
  assert.deepEqual(achievementIdsFor({
    entries_total: 0,
    photo_entries: 0,
    days_logged: 0,
    best_streak_days: 0,
  }), []);
  assert.deepEqual(achievementIdsFor({
    entries_total: 100,
    photo_entries: 10,
    days_logged: 30,
    best_streak_days: 30,
  }).sort(), [
    "days_30",
    "days_7",
    "entries_10",
    "entries_100",
    "entries_50",
    "first_entry",
    "first_photo",
    "photos_10",
    "streak_3",
    "streak_30",
    "streak_7",
  ]);
});

test("the helper writes only the first 20 declared stats, in declared order", () => {
  assert.ok(STATS.length <= 20);
  assert.deepEqual(
    STATS.filter((item) => item.monotonic).map((item) => item.key),
    ["days_logged", "entries_total", "photo_entries", "best_streak_days"],
  );
  assert.equal(STATS.find((item) => item.key === "current_streak_days").monotonic, false);
  const declared = [];
  const stats = { not_declared: 7 };
  for (let i = 0; i < 21; i += 1) {
    const key = `stat_${String(i).padStart(2, "0")}`;
    declared.push({ key, monotonic: false });
    stats[key] = i;
  }
  const storage = memoryStorage();
  const record = metaUpdate("food-log", APP_VERSION, { stats }, {
    storage,
    declared,
    clock: freshClock(),
  });
  assert.deepEqual(Object.keys(record.stats), declared.slice(0, 20).map((item) => item.key));
  assert.equal(record.stats.stat_20, undefined);
  assert.equal(record.stats.not_declared, undefined);
  assert.equal(record.stats.stat_00, 0);
  assert.equal(record.stats.stat_19, 19);
});

test("monotonic counts and bests keep the higher value", () => {
  const storage = memoryStorage();
  const clock = freshClock(5_000);
  const deps = { storage, declared: STATS, clock };
  metaUpdate("food-log", APP_VERSION, {
    stats: {
      days_logged: 4,
      entries_total: 9,
      photo_entries: 2,
      current_streak_days: 4,
      best_streak_days: 6,
      kcal_total: 500,
    },
    logros: ["first_entry"],
  }, { ...deps, now: new Date("2026-10-20T00:00:00.000Z") });
  clock.nowMs += 1000;
  const second = metaUpdate("food-log", APP_VERSION, {
    stats: {
      entries_total: 3,
      photo_entries: Number.NaN,
      current_streak_days: 0,
      best_streak_days: 2,
    },
    logros: [],
  }, { ...deps, now: new Date("2026-10-23T00:00:00.000Z") });
  assert.deepEqual(second.stats, {
    days_logged: 4,
    entries_total: 9,
    photo_entries: 2,
    current_streak_days: 0,
    best_streak_days: 6,
  });
  assert.equal(second.stats.kcal_total, undefined);
  assert.deepEqual(second.logros, ["first_entry"]);
});

test("demo and preview modes do not write or post", () => {
  const now = new Date("2026-10-23T18:00:00.000Z");
  const rawSave = JSON.stringify(envelope([
    entry("2026-10-23T12:00:00.000Z", { description: "TOKEN_FOOD", image_data_url: GIF }),
  ]));
  for (const search of ["?demo=1", "?preview=1", "?page=1&demo=1"]) {
    const storage = memoryStorage({
      [STORAGE_KEY]: rawSave,
      [KEY]: "{not json",
    });
    let posts = 0;
    const view = {
      location: { origin: "https://portfolio.test" },
      parent: { postMessage() { posts += 1; } },
    };
    const clock = freshClock();
    const record = backfillProgress(JSON.parse(rawSave), { storage, search, clock, now, window: view });
    syncProgress(JSON.parse(rawSave), { storage, search, clock, now, window: view });
    flushProgress();
    assert.equal(record, null);
    assert.equal(posts, 0);
    assert.equal(storage.getItem(KEY), "{not json");
    assert.equal(storage.getItem(`${KEY}.corrupt`), null);
    assert.equal(storage.getItem(STORAGE_KEY), rawSave);
    assert.equal(storage.writes.length, 0);
  }
});

test("load and play leave the saved meals byte-identical", () => {
  const now = atLocal(2026, 10, 21, 18);
  const saved = envelope([
    entry(atLocal(2026, 10, 21, 13).toISOString(), {
      id: "entry-photo",
      description: "TOKEN_FOOD",
      portion: "TOKEN_PORTION",
      notes: "TOKEN_NOTE",
      kcal: 987654,
      image_data_url: GIF,
    }),
  ]);
  const rawSave = JSON.stringify(saved);
  const storage = memoryStorage({ [STORAGE_KEY]: rawSave, "other.setting": "keep-me" });
  const read = readEnvelope(storage);
  const clock = freshClock(1_000);
  backfillProgress(read.envelope, { storage, clock, now });
  clock.nowMs += 1000;
  syncProgress({
    data: { entries: read.envelope.data.entries },
  }, { storage, clock, now });
  assert.equal(storage.getItem(STORAGE_KEY), rawSave);
  assert.equal(storage.getItem("other.setting"), "keep-me");
  assert.deepEqual(storage.writes, [KEY, KEY]);
  const meta = storage.getItem(KEY);
  assert.equal(meta.includes("TOKEN_FOOD"), false);
  assert.equal(meta.includes("TOKEN_NOTE"), false);
  assert.equal(meta.includes("TOKEN_PORTION"), false);
  assert.equal(meta.includes("987654"), false);
  assert.equal(meta.includes("R0lGODlh"), false);
  assert.equal(meta.includes("file-token"), false);
  assert.ok(meta.length < rawSave.length);
});
