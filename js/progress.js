import { APP_ID, APP_VERSION } from "./config.js";
import { backfillMeta, scheduleMetaUpdate } from "./meta.js";

const DAY_MS = 86400000;

// Declared stat keys, in stored order. Monotonic counts and bests never decrease.
export const STATS = [
  { key: "days_logged", monotonic: true }, // days with a meal
  { key: "entries_total", monotonic: true }, // meals saved
  { key: "photo_entries", monotonic: true }, // meals with a photo
  { key: "current_streak_days", monotonic: false }, // active streak
  { key: "best_streak_days", monotonic: true }, // longest streak
];

// Stable ids. A logro stays once the count has been reached.
export const ACHIEVEMENTS = [
  { id: "first_entry", met: (stats) => stats.entries_total >= 1 }, // 1 meal saved
  { id: "entries_10", met: (stats) => stats.entries_total >= 10 }, // 10 meals saved
  { id: "entries_50", met: (stats) => stats.entries_total >= 50 }, // 50 meals saved
  { id: "entries_100", met: (stats) => stats.entries_total >= 100 }, // 100 meals saved
  { id: "first_photo", met: (stats) => stats.photo_entries >= 1 }, // 1 photo
  { id: "photos_10", met: (stats) => stats.photo_entries >= 10 }, // 10 photos
  { id: "days_7", met: (stats) => stats.days_logged >= 7 }, // 7 different days
  { id: "days_30", met: (stats) => stats.days_logged >= 30 }, // 30 different days
  { id: "streak_3", met: (stats) => stats.best_streak_days >= 3 }, // best streak of 3 days
  { id: "streak_7", met: (stats) => stats.best_streak_days >= 7 }, // best streak of 7 days
  { id: "streak_30", met: (stats) => stats.best_streak_days >= 30 }, // best streak of 30 days
];

function localDayIndex(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

function hasPhoto(entry) {
  return (typeof entry.image_key === "string" && entry.image_key.length > 0)
    || (typeof entry.image_data_url === "string" && entry.image_data_url.length > 0);
}

function bestStreak(days) {
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of sorted) {
    run = prev != null && day === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }
  return best;
}

function currentStreak(days, today) {
  if (today == null) return 0;
  let end = null;
  if (days.has(today)) end = today;
  else if (days.has(today - 1)) end = today - 1;
  else return 0;
  let count = 0;
  while (days.has(end)) {
    count += 1;
    end -= 1;
  }
  return count;
}

export function progressStats(entries, now = new Date()) {
  const list = Array.isArray(entries) ? entries : [];
  const when = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  let entriesTotal = 0;
  let photoEntries = 0;
  const days = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    entriesTotal += 1;
    if (hasPhoto(entry)) photoEntries += 1;
    const day = localDayIndex(entry.created_at);
    if (day != null) days.add(day);
  }
  return {
    days_logged: days.size,
    entries_total: entriesTotal,
    photo_entries: photoEntries,
    current_streak_days: currentStreak(days, localDayIndex(when)),
    best_streak_days: bestStreak(days),
  };
}

export function achievementIdsFor(stats) {
  return ACHIEVEMENTS.filter((item) => item.met(stats)).map((item) => item.id);
}

function snapshot(envelope, now) {
  const stats = progressStats(envelope?.data?.entries, now);
  return { stats, logros: achievementIdsFor(stats) };
}

function metaDeps(deps = {}) {
  return { ...deps, declared: STATS };
}

export function backfillProgress(envelope, deps = {}) {
  try {
    return backfillMeta(APP_ID, APP_VERSION, snapshot(envelope, deps.now), metaDeps(deps));
  } catch {
    return null;
  }
}

export function syncProgress(envelope, deps = {}) {
  try {
    scheduleMetaUpdate(APP_ID, APP_VERSION, snapshot(envelope, deps.now), metaDeps(deps));
  } catch {
    /* ignore */
  }
}

export function flushProgress() {
  try {
    scheduleMetaUpdate.flush();
  } catch {
    /* ignore */
  }
}
