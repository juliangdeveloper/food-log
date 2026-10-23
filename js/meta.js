const META_VERSION = 1;
const MIN_INTERVAL_MS = 1000;
const MAX_STATS = 20;
const ID_RE = /^[a-z][a-z0-9_]*$/;

export function metaStorageKey(slug) {
  return `meta.v1.${slug}`;
}

function storageOf(deps) {
  if (deps && Object.prototype.hasOwnProperty.call(deps, "storage")) return deps.storage;
  return globalThis.localStorage;
}

function finiteStats(stats) {
  const out = {};
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return out;
  for (const key of Object.keys(stats)) {
    if (Object.keys(out).length >= MAX_STATS) break;
    if (!ID_RE.test(key)) continue;
    const value = stats[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
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

function readRecord(storage, key) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

function postMeta(key, record, deps) {
  try {
    const view = deps && Object.prototype.hasOwnProperty.call(deps, "window")
      ? deps.window
      : (typeof window !== "undefined" ? window : null);
    if (!view || view.parent === view) return;
    view.parent.postMessage({ type: "meta", key, data: record }, view.location.origin);
  } catch {
    /* ignore */
  }
}

export function metaUpdate(slug, version, payload = {}, deps = {}) {
  try {
    const storage = storageOf(deps);
    if (!storage) return null;
    const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const key = metaStorageKey(slug);
    const nowDate = deps.now instanceof Date && !Number.isNaN(deps.now.getTime()) ? deps.now : new Date();
    const now = nowDate.toISOString();
    let existing = null;
    try {
      existing = readRecord(storage, key);
    } catch {
      existing = null;
    }
    const prev = existing || {};
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
      version: String(version),
      updatedAt: now,
      stats: finiteStats(body.stats),
      logros,
      hitos,
    };
    storage.setItem(key, JSON.stringify(record));
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
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

export function createMetaScheduler() {
  let queued = null;
  let timer = null;
  let lastRun = 0;

  function flush() {
    timer = null;
    const job = queued;
    queued = null;
    if (!job) return;
    lastRun = Date.now();
    metaUpdate(job.slug, job.version, job.payload, job.deps);
  }

  function scheduleMetaUpdate(slug, version, payload = {}, deps = {}) {
    try {
      queued = { slug, version, payload, deps };
      if (timer) return;
      const elapsed = lastRun === 0 ? MIN_INTERVAL_MS : Date.now() - lastRun;
      if (elapsed >= MIN_INTERVAL_MS) {
        flush();
        return;
      }
      timer = setTimeout(flush, MIN_INTERVAL_MS - elapsed);
      if (typeof timer.unref === "function") timer.unref();
    } catch {
      /* ignore */
    }
  }

  scheduleMetaUpdate.flush = function flushPending() {
    try {
      if (!queued) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    } catch {
      /* ignore */
    }
  };

  return scheduleMetaUpdate;
}

export const scheduleMetaUpdate = createMetaScheduler();
