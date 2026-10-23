import assert from "node:assert/strict";
import test from "node:test";
import { STATS } from "../js/progress.js";
import { PROYECTO, backfillMeta, metaProyecto, metaSetProyecto, metaStorageKey, metaUpdate } from "../js/meta.js";

const SLUG = "food-log";
const KEY = metaStorageKey(SLUG);

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
  };
}

function deps(storage) {
  return { storage, clock: { lastWriteAt: null }, immediate: true, demo: false };
}

test.beforeEach(() => metaSetProyecto(null));
test.after(() => metaSetProyecto(null));

test("PROYECTO is a valid block within the shared ranges", () => {
  assert.deepEqual(metaProyecto(PROYECTO), { ...PROYECTO });
  assert.ok(Array.from(PROYECTO.objetivo).length <= 140);
  const keys = Object.keys(STATS);
  assert.equal(keys.some((k) => k === "proyecto" || String(k).startsWith("fase")), false);
});

test("backfill and updates write the proyecto block outside stats", () => {
  const storage = memoryStorage();
  const rec = backfillMeta(SLUG, "v9.9.9", { stats: {}, logros: [] }, deps(storage));
  assert.ok(rec);
  const stored = JSON.parse(storage.getItem(KEY));
  assert.equal(stored.v, 1);
  assert.deepEqual(stored.proyecto, { ...PROYECTO });
  assert.equal("proyecto" in stored.stats, false);
  metaUpdate(SLUG, "v9.9.9", { stats: {}, logros: [] }, deps(storage));
  assert.deepEqual(JSON.parse(storage.getItem(KEY)).proyecto, { ...PROYECTO });
});

test("an invalid block is left out and never throws", () => {
  const bad = [
    "x", [], {},
    { ...PROYECTO, objetivo: "" },
    { ...PROYECTO, objetivo: "a".repeat(141) },
    { ...PROYECTO, objetivo: 5 },
    { ...PROYECTO, fase: 0 }, { ...PROYECTO, fase: 8 }, { ...PROYECTO, fase: 2.5 }, { ...PROYECTO, fase: "4" },
    { ...PROYECTO, fase_estado: -1 }, { ...PROYECTO, fase_estado: 5 },
    { ...PROYECTO, fases_completadas: 7 }, { ...PROYECTO, fases_completadas: NaN },
    { get objetivo() { throw new Error("boom"); } },
  ];
  for (const p of bad) {
    assert.equal(metaProyecto(p), null);
    const storage = memoryStorage();
    metaSetProyecto(p);
    let rec;
    assert.doesNotThrow(() => { rec = metaUpdate(SLUG, "v9.9.9", { stats: {}, logros: ["first_entry"] }, deps(storage)); });
    assert.ok(rec);
    const stored = JSON.parse(storage.getItem(KEY));
    assert.equal("proyecto" in stored, false);
    assert.deepEqual(stored.logros, ["first_entry"]);
  }
});

test("an old record without proyecto is still valid and gains the block", () => {
  const old = {
    v: 1, slug: SLUG, version: "0.2.4", updatedAt: "2026-01-01T00:00:00.000Z",
    stats: {}, logros: ["first_entry"], hitos: { first_entry: "2026-01-01T00:00:00.000Z" },
  };
  const storage = memoryStorage({ [KEY]: JSON.stringify(old) });
  backfillMeta(SLUG, "v9.9.9", { stats: {}, logros: [] }, deps(storage));
  assert.equal(storage.getItem(`${KEY}.corrupt`), null);
  assert.equal(storage.getItem(KEY), JSON.stringify(old));
  const rec = metaUpdate(SLUG, "v9.9.9", { stats: {}, logros: [] }, deps(storage));
  assert.equal(rec.hitos.first_entry, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(rec.proyecto, { ...PROYECTO });
});

test("a stored record with a different proyecto gets the current block on the next write", () => {
  const old = {
    v: 1, slug: SLUG, version: "0.2.4", updatedAt: "2026-01-01T00:00:00.000Z",
    stats: {}, logros: ["first_entry"], hitos: { first_entry: "2026-01-01T00:00:00.000Z" },
    proyecto: { extra: 1, objetivo: "Objetivo anterior.", fase: 2, fase_estado: 3, fases_completadas: 1 },
  };
  const storage = memoryStorage({ [KEY]: JSON.stringify(old) });
  metaUpdate(SLUG, "v9.9.9", { stats: {}, logros: [] }, deps(storage));
  const rec = JSON.parse(storage.getItem(KEY));
  assert.deepEqual(rec.proyecto, { ...PROYECTO });
  assert.equal(rec.hitos.first_entry, "2026-01-01T00:00:00.000Z");
  assert.equal(storage.getItem(`${KEY}.corrupt`), null);

  metaSetProyecto({ fase: 9 });
  const second = memoryStorage({ [KEY]: JSON.stringify(old) });
  metaUpdate(SLUG, "v9.9.9", { stats: {}, logros: [] }, deps(second));
  assert.equal("proyecto" in JSON.parse(second.getItem(KEY)), false);
});

test("fase 7 (Descartada) is accepted", () => {
  const D = { ...PROYECTO, fase: 7, fase_estado: 4 };
  assert.deepEqual(metaProyecto(D), D);
});
