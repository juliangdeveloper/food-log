const META_VERSION = 1;
const MIN_INTERVAL_MS = 1000;
const MAX_STATS = 20;
const ID_RE = /^[a-z][a-z0-9_]*$/;
const globalClock = { lastWriteAt: null };

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

function isDemo(deps) {
  if (deps && deps.demo === true) return true;
  if (deps && deps.demo === false) return false;
  try {
    const search = deps && Object.prototype.hasOwnProperty.call(deps, "search")
      ? deps.search
      : (typeof location !== "undefined" ? location.search : "");
    const params = new URLSearchParams(String(search || ""));
    return params.get("demo") === "1" || params.get("preview") === "1";
  } catch {
    return false;
  }
}

function plainVersion(version) {
  const text = String(version ?? "").trim();
  return text.replace(/^v/i, "");
}

function declaredList(declared) {
  if (!Array.isArray(declared)) return [];
  return declared.slice(0, MAX_STATS);
}

function mergeStats(previous, incoming, declared) {
  const prev = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
  const next = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  const out = {};
  const seen = new Set();
  for (const item of declaredList(declared)) {
    const key = typeof item === "string" ? item : item?.key;
    const monotonic = typeof item === "object" && item?.monotonic === true;
    if (typeof key !== "string" || !ID_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    const oldValue = typeof prev[key] === "number" && Number.isFinite(prev[key]) ? prev[key] : undefined;
    const newValue = typeof next[key] === "number" && Number.isFinite(next[key]) ? next[key] : undefined;
    let value;
    if (newValue !== undefined && oldValue !== undefined && monotonic) value = Math.max(oldValue, newValue);
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
    /* ignore */
  }
}

export function metaUpdate(slug, version, payload = {}, deps = {}) {
  try {
    if (isDemo(deps)) return null;
    if (waitFor(deps) > 0) return null;
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
    if (isDemo(deps)) return null;
    const storage = storageOf(deps);
    if (!storage) return null;
    const key = metaStorageKey(slug);
    const raw = storage.getItem(key);
    if (raw == null) return metaUpdate(slug, version, payload, deps);
    try {
      const valid = parseValid(raw, slug);
      if (valid) return valid;
    } catch {
      /* rebuild below */
    }
    try {
      storage.setItem(`${key}.corrupt`, raw);
    } catch {
      /* ignore */
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

  function writeQueued() {
    timer = null;
    if (!queued) return;
    const wait = waitFor(queued.deps);
    if (wait > 0) {
      later(writeQueued, wait);
      return;
    }
    const job = queued;
    queued = null;
    metaUpdate(job.slug, job.version, job.payload, job.deps);
  }

  function scheduleMetaUpdate(slug, version, payload = {}, deps = {}) {
    try {
      if (isDemo(deps)) return;
      queued = { slug, version, payload, deps: deps || {} };
      if (timer) return;
      const wait = waitFor(queued.deps);
      if (wait === 0) {
        writeQueued();
        return;
      }
      later(writeQueued, wait);
    } catch {
      /* ignore */
    }
  }

  scheduleMetaUpdate.flush = function flushPending() {
    try {
      if (!queued) return;
      if (waitFor(queued.deps) > 0) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      writeQueued();
    } catch {
      /* ignore */
    }
  };

  return scheduleMetaUpdate;
}

export const scheduleMetaUpdate = createMetaScheduler();
