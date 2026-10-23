import assert from "node:assert/strict";
import test from "node:test";
import { ESTADO_FASE, FASE, PROYECTO, TIPO_STAT, metaProyecto, metaUpdate } from "../js/meta.js";
import { STATS } from "../js/progress.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("los enums están congelados y PROYECTO usa sus valores", () => {
  for (const e of [FASE, ESTADO_FASE, TIPO_STAT, STATS]) assert.ok(Object.isFrozen(e));
  assert.deepEqual(Object.values(FASE), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(Object.values(ESTADO_FASE), [0, 1, 2, 3, 4]);
  assert.equal(PROYECTO.fase, FASE.DESCARTADA);
  assert.equal(PROYECTO.fase_estado, ESTADO_FASE.COMPLETADA);
  assert.deepEqual(metaProyecto(PROYECTO), { ...PROYECTO });
});

test("cada stat declara un tipo válido y una unidad, y la mezcla respeta su tipo", () => {
  const tipos = Object.values(TIPO_STAT);
  const keys = Object.keys(STATS);
  assert.ok(keys.length >= 1 && keys.length <= 20);
  for (const key of keys) {
    assert.ok(tipos.includes(STATS[key].tipo), key);
    assert.ok(typeof STATS[key].unidad === "string" && STATS[key].unidad.length > 0, key);
  }
  const declared = { ...STATS, en_curso: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "prueba" } };
  const alto = {};
  const bajo = {};
  for (const key of Object.keys(declared)) {
    alto[key] = 10;
    bajo[key] = 3;
  }
  const storage = memoryStorage();
  const clock = { lastWriteAt: null, nowMs: 5_000 };
  const deps = { storage, declared, clock };
  metaUpdate("food-log", "1", { stats: alto, logros: [] }, deps);
  clock.nowMs += 1000;
  const record = metaUpdate("food-log", "1", { stats: bajo, logros: [] }, deps);
  for (const key of Object.keys(declared)) {
    assert.equal(record.stats[key], declared[key].tipo === TIPO_STAT.VALOR_ACTUAL ? 3 : 10, key);
  }
});
