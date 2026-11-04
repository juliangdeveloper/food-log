const META_VERSION = 1;
const MIN_INTERVAL_MS = 1000;
const MAX_STATS = 20;
const ID_RE = /^[a-z][a-z0-9_]*$/;
const globalClock = { lastWriteAt: null };

export const FASE = Object.freeze({ IDEA: 1, DEFINICION: 2, DISENO: 3, CONSTRUCCION: 4, VALIDACION: 5, LANZAMIENTO_Y_MANTENIMIENTO: 6, DESCARTADA: 7 });
export const ESTADO_FASE = Object.freeze({ PENDIENTE: 0, EN_CURSO: 1, BLOQUEADA: 2, EN_REVISION: 3, COMPLETADA: 4 });
export const TIPO_STAT = Object.freeze({ TOTAL_ACUMULADO: 'total_acumulado', MEJOR_MARCA: 'mejor_marca', VALOR_ACTUAL: 'valor_actual' });
export const TIPO_PROYECTO = Object.freeze({ PROYECTO: 'proyecto', AREA: 'area', RECURSO: 'recurso', ARCHIVO: 'archivo' });

export const PROYECTO = {
  objetivo: 'En algún momento pensé que era una buena idea, pero tal vez te sirva de inspiración.',
  fase: FASE.DESCARTADA,
  fase_estado: ESTADO_FASE.COMPLETADA,
  fases_completadas: 2,
  tipo: TIPO_PROYECTO.AREA,
  aportes: [
    { stat: 'Programación', exp: 16, fuente: 'creacion' },
    { stat: 'Diseño', exp: 4, fuente: 'creacion' },
    { stat: 'Nutrición', exp: 20, fuente: 'uso' }
  ]
};

let proyectoSource = PROYECTO;

function proyectoInt(n, lo, hi) {
  return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
}

export function enumValido(enumeracion, valor) {
  return Object.values(enumeracion).indexOf(valor) !== -1;
}

export function statConservaMaximo(tipo) {
  return tipo === TIPO_STAT.TOTAL_ACUMULADO || tipo === TIPO_STAT.MEJOR_MARCA;
}

export function statsDeclarados(stats) {
  if (Array.isArray(stats)) return stats;
  if (!stats || typeof stats !== 'object') return [];
  return Object.keys(stats).map(function (key) { return { key: key, tipo: stats[key] && stats[key].tipo }; });
}

const APORTE_STAT_MAX = 32;
const APORTE_EXP_MAX = 99;

function aportesValidos(lista) {
  if (!Array.isArray(lista)) return null;
  const out = [];
  const seen = {};
  for (let i = 0; i < lista.length; i++) {
    const it = lista[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
    const stat = it.stat;
    const exp = it.exp;
    const fuente = it.fuente;
    if (typeof stat !== 'string' || !stat.trim() || stat !== stat.trim() || Array.from(stat).length > APORTE_STAT_MAX) return null;
    if (fuente !== 'creacion' && fuente !== 'uso') return null;
    if (!(proyectoInt(exp, 1, APORTE_EXP_MAX))) return null;
    const key = stat + '\n' + fuente;
    if (seen[key]) return null;
    if (Object.keys(it).length !== 3) return null;
    seen[key] = true;
    out.push({ stat: stat, exp: exp, fuente: fuente });
  }
  return out;
}

export function metaProyecto(p) {
  try {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const o = p.objetivo;
    if (typeof o !== 'string' || !o.trim() || Array.from(o).length > 140) return null;
    if (!enumValido(FASE, p.fase) || !enumValido(ESTADO_FASE, p.fase_estado) || !proyectoInt(p.fases_completadas, 0, FASE.LANZAMIENTO_Y_MANTENIMIENTO)) return null;
    if (p.tipo !== undefined && !enumValido(TIPO_PROYECTO, p.tipo)) return null;
    const bloque = { objetivo: o, fase: p.fase, fase_estado: p.fase_estado, fases_completadas: p.fases_completadas };
    if (p.tipo !== undefined) bloque.tipo = p.tipo;
    if (p.bloqueada === true) bloque.bloqueada = true;
    if (p.aportes !== undefined) {
      const aportes = aportesValidos(p.aportes);
      if (!aportes) return null;
      bloque.aportes = aportes;
    }
    return bloque;
  } catch (e) {
    return null;
  }
}

export function metaSetProyecto(p) {
  proyectoSource = p === null ? PROYECTO : p;
}

export function metaDeclararProyecto(slug, version) {
  try {
    const store = globalThis.localStorage;
    if (!store || !slug) return null;
    const clave = "meta.v1." + slug;
    const raw = store.getItem(clave);
    let base = null;
    if (raw != null && raw !== "") {
      try {
        const previo = JSON.parse(raw);
        if (previo && typeof previo === "object" && !Array.isArray(previo) && previo.v === 1 && previo.slug === slug) base = previo;
      } catch (e) {
        base = null;
      }
      if (!base) store.setItem(clave + ".corrupt", String(raw));
    }
    if (!base) base = { v: 1, slug: slug, version: String(version == null ? "" : version).replace(/^[vV]/, ""), updatedAt: new Date().toISOString(), stats: {}, logros: [], hitos: {} };
    const p = metaProyecto(proyectoSource);
    if (p) base.proyecto = p;
    const texto = JSON.stringify(base);
    if (texto !== raw) {
      store.setItem(clave, texto);
      if (typeof window !== "undefined" && window.parent && window.parent !== window) window.parent.postMessage({ type: "meta", key: clave, data: base }, location.origin);
    }
    return base;
  } catch (e) {
    return null;
  }
}

function withProyecto(record) {
  const p = metaProyecto(proyectoSource);
  if (p) record.proyecto = p;
  return record;
}

export function metaStorageKey(slug) {
  return `meta.v1.${slug}`;
}

function storageOf(deps) {
  if (deps && Object.prototype.hasOwnProperty.call(deps, "storage")) return deps.storage;
  return globalThis.localStorage;
}

function clockOf(deps) {
  if (deps && deps.clock && typeof deps.clock === "object") return deps.clock;
  return globalClock;
}

function nowMs(deps) {
  const clock = clockOf(deps);
  if (typeof clock.nowMs === "number") return clock.nowMs;
  if (deps && typeof deps.nowMs === "number") return deps.nowMs;
  return Date.now();
}

function waitFor(deps) {
  const clock = clockOf(deps);
  if (clock.lastWriteAt == null) return 0;
  return Math.max(0, MIN_INTERVAL_MS - (nowMs(deps) - clock.lastWriteAt));
}

function plainVersion(version) {
  const text = String(version ?? "").trim();
  return text.replace(/^v/i, "");
}

function declaredList(declared) {
  return statsDeclarados(declared).slice(0, MAX_STATS);
}

function mergeStats(previous, incoming, declared) {
  const prev = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
  const next = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  const out = {};
  const seen = new Set();
  for (const item of declaredList(declared)) {
    const key = typeof item === "string" ? item : item?.key;
    const conservaMaximo = typeof item === "object" && statConservaMaximo(item?.tipo);
    if (typeof key !== "string" || !ID_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    const oldValue = typeof prev[key] === "number" && Number.isFinite(prev[key]) ? prev[key] : undefined;
    const newValue = typeof next[key] === "number" && Number.isFinite(next[key]) ? next[key] : undefined;
    let value;
    if (newValue !== undefined && oldValue !== undefined && conservaMaximo) value = Math.max(oldValue, newValue);
    else if (newValue !== undefined) value = newValue;
    else if (oldValue !== undefined) value = oldValue;
    else continue;
    out[key] = value;
  }
  return out;
}

function cleanIds(list) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(list)) return out;
  for (const id of list) {
    if (typeof id !== "string" || !ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function parseValid(raw, slug) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.v !== META_VERSION || parsed.slug !== slug) return null;
  return parsed;
}

function previousRecord(storage, key, slug) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return parseValid(raw, slug);
  } catch {
    return null;
  }
}

function postMeta(key, record, deps) {
  try {
    const view = deps && Object.prototype.hasOwnProperty.call(deps, "window")
      ? deps.window
      : (typeof window !== "undefined" ? window : null);
    if (!view || view.parent === view) return;
    view.parent.postMessage({ type: "meta", key, data: record }, view.location.origin);
  } catch {
  }
}

export function metaUpdate(slug, version, payload = {}, deps = {}) {
  try {
    if (deps?.immediate !== true && waitFor(deps) > 0) return null;
    const storage = storageOf(deps);
    if (!storage) return null;
    const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const key = metaStorageKey(slug);
    const nowDate = deps.now instanceof Date && !Number.isNaN(deps.now.getTime()) ? deps.now : new Date();
    const now = nowDate.toISOString();
    const prev = previousRecord(storage, key, slug) || {};
    const prevHitos = prev.hitos && typeof prev.hitos === "object" && !Array.isArray(prev.hitos) ? prev.hitos : {};
    const logros = cleanIds([...(Array.isArray(prev.logros) ? prev.logros : []), ...(Array.isArray(body.logros) ? body.logros : [])]).sort();
    const hitos = {};
    for (const id of logros) {
      const prior = prevHitos[id];
      hitos[id] = typeof prior === "string" && prior ? prior : now;
    }
    const record = {
      v: META_VERSION,
      slug,
      version: plainVersion(version),
      updatedAt: now,
      stats: mergeStats(prev.stats, body.stats, deps.declared),
      logros,
      hitos,
    };
    withProyecto(record);
    storage.setItem(key, JSON.stringify(record));
    clockOf(deps).lastWriteAt = nowMs(deps);
    postMeta(key, record, deps);
    return record;
  } catch {
    return null;
  }
}

export function backfillMeta(slug, version, payload = {}, deps = {}) {
  try {
    const storage = storageOf(deps);
    if (!storage) return null;
    const key = metaStorageKey(slug);
    const raw = storage.getItem(key);
    if (raw == null) return metaUpdate(slug, version, payload, deps);
    try {
      const valid = parseValid(raw, slug);
      if (valid) return valid;
    } catch {
    }
    try {
      storage.setItem(`${key}.corrupt`, raw);
    } catch {
    }
    return metaUpdate(slug, version, payload, deps);
  } catch {
    return null;
  }
}

export function createMetaScheduler() {
  let queued = null;
  let timer = null;

  function later(fn, delay) {
    timer = setTimeout(fn, delay);
    if (typeof timer.unref === "function") timer.unref();
  }

  function writeQueued(force) {
    timer = null;
    if (!queued) return;
    if (!force) {
      const wait = waitFor(queued.deps);
      if (wait > 0) {
        later(() => writeQueued(false), wait);
        return;
      }
    }
    const job = queued;
    queued = null;
    const deps = force ? { ...job.deps, immediate: true } : job.deps;
    metaUpdate(job.slug, job.version, job.payload, deps);
  }

  function scheduleMetaUpdate(slug, version, payload = {}, deps = {}) {
    try {
      queued = { slug, version, payload, deps: deps || {} };
      if (timer) return;
      const wait = waitFor(queued.deps);
      if (wait === 0) {
        writeQueued(false);
        return;
      }
      later(() => writeQueued(false), wait);
    } catch {
    }
  }

  scheduleMetaUpdate.flush = function flushPending() {
    try {
      if (!queued) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      writeQueued(true);
    } catch {
    }
  };

  return scheduleMetaUpdate;
}

export const scheduleMetaUpdate = createMetaScheduler();
