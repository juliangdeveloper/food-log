import { APP_VERSION, GOOGLE_CLIENT_ID, STORAGE_KEY } from "./config.js";
import { pickSpreadsheet } from "./drive.js";
import { readOriginalImageFile } from "./image.js";
import {
  MEAL_LABELS,
  buildEntry,
  entriesForLocalDay,
  importEnvelope,
  isImageDataUrl,
  parseFileId,
} from "./model.js";
import {
  migrateEnvelope,
  openPhotoStore,
  persistEnvelope,
  placeOriginalPhoto,
  readEnvelope,
  requestPersistentStorage,
} from "./storage.js";

const $ = (id) => document.getElementById(id);

const descriptionEl = $("description");
const portionEl = $("portion");
const notesEl = $("notes");
const kcalEl = $("kcal");
const formError = $("form-error");
const saveBtn = $("save-entry");
const preview = $("preview");
const previewImg = $("preview-img");
const cameraInput = $("camera-input");
const galleryInput = $("gallery-input");
const todayList = $("today-list");
const todayEmpty = $("today-empty");
const todayCount = $("today-count");
const todayDate = $("today-date");
const overridesInput = $("overrides-file-id");
const overridesCurrent = $("overrides-current");
const mealsInput = $("meals-file-id");
const mealsCurrent = $("meals-current");
const driveNote = $("drive-note");
const driveStatus = $("drive-status");
const toastEl = $("toast");
const settingsDialog = $("settings-dialog");
const backupDialog = $("backup-dialog");
const confirmDialog = $("confirm-dialog");
const confirmText = $("confirm-text");
const storageStatus = $("storage-status");

let envelope = readEnvelope().envelope;
let photos = null;
let ready = false;
let pendingFile = null;
let pendingPreviewUrl = null;
let mealType = null;
let hunger = null;
let busy = false;
let toastTimer = 0;
let renderGeneration = 0;
const entryUrls = new Set();

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3400);
}

function setError(message) {
  if (!message) {
    formError.hidden = true;
    formError.textContent = "";
    return;
  }
  formError.hidden = false;
  formError.textContent = message;
}

function setBusy(next) {
  busy = next;
  saveBtn.disabled = next;
  cameraInput.disabled = next;
  galleryInput.disabled = next;
}

function formatLongDate(date) {
  const text = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  return text.charAt(0).toLocaleUpperCase("es-CO") + text.slice(1);
}

function formatTime(iso) {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatKcal(value) {
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(value)} kcal`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  const formatted = new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${formatted} ${units[unit]}`;
}

function commit(next) {
  const saved = persistEnvelope(next);
  if (!saved.ok) {
    toast(saved.error === "quota"
      ? "No cabe en el almacenamiento del navegador. Borra alguna foto e intenta de nuevo."
      : "No se pudo guardar en este navegador.");
    return false;
  }
  envelope = saved.envelope;
  return true;
}

function syncChips() {
  document.querySelectorAll("[data-meal]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.meal === mealType ? "true" : "false");
  });
  document.querySelectorAll("[data-hunger]").forEach((button) => {
    button.setAttribute("aria-pressed", Number(button.dataset.hunger) === hunger ? "true" : "false");
  });
}

function updateSaveLabel() {
  const hasText = descriptionEl.value.trim().length > 0;
  saveBtn.textContent = pendingFile && !hasText ? "Confirmar foto" : "Guardar";
}

function revokeEntryUrls() {
  for (const url of entryUrls) URL.revokeObjectURL(url);
  entryUrls.clear();
}

function clearPendingPhoto() {
  pendingFile = null;
  if (pendingPreviewUrl) {
    URL.revokeObjectURL(pendingPreviewUrl);
    pendingPreviewUrl = null;
  }
  preview.hidden = true;
  previewImg.removeAttribute("src");
}

function resetForm() {
  clearPendingPhoto();
  mealType = null;
  hunger = null;
  descriptionEl.value = "";
  portionEl.value = "";
  notesEl.value = "";
  kcalEl.value = "";
  cameraInput.value = "";
  galleryInput.value = "";
  setError("");
  syncChips();
  updateSaveLabel();
}

async function resolveEntryImage(entry) {
  if (entry.image_key && photos) {
    try {
      const blob = await photos.get(entry.image_key);
      if (blob) return URL.createObjectURL(blob);
    } catch {
      // Fall through to a legacy data URL when the blob cannot be read.
    }
  }
  if (isImageDataUrl(entry.image_data_url)) return entry.image_data_url;
  return null;
}

async function renderToday() {
  const generation = ++renderGeneration;
  revokeEntryUrls();
  const entries = entriesForLocalDay(envelope.data.entries, new Date());
  todayCount.textContent = entries.length === 1 ? "1 comida" : `${entries.length} comidas`;
  todayEmpty.hidden = entries.length > 0;
  todayList.replaceChildren();
  const images = [];
  for (const entry of entries) {
    const view = renderEntry(entry);
    todayList.append(view.li);
    if (view.img) images.push({ entry, img: view.img });
  }
  await Promise.all(images.map(async ({ entry, img }) => {
    const src = await resolveEntryImage(entry);
    if (generation !== renderGeneration) {
      if (src?.startsWith("blob:")) URL.revokeObjectURL(src);
      return;
    }
    if (!src) {
      img.remove();
      return;
    }
    if (src.startsWith("blob:")) entryUrls.add(src);
    img.src = src;
  }));
}

function renderEntry(entry) {
  const li = document.createElement("li");
  li.className = "entry";
  li.dataset.id = entry.id;

  const top = document.createElement("div");
  top.className = "entry-top";
  const time = document.createElement("time");
  time.dateTime = entry.created_at;
  time.textContent = formatTime(entry.created_at);
  const meal = document.createElement("span");
  meal.className = "pill";
  meal.textContent = entry.meal_type ? MEAL_LABELS[entry.meal_type] : "Sin tipo";
  top.append(time, meal);

  const title = document.createElement("p");
  title.className = "entry-title";
  title.textContent = entry.description || "Foto";
  li.append(top, title);

  let img = null;
  if (entry.image_key || isImageDataUrl(entry.image_data_url)) {
    img = document.createElement("img");
    img.className = "entry-photo";
    img.alt = entry.description ? `Foto: ${entry.description}` : "Foto de la comida";
    li.append(img);
  }

  const bits = [];
  if (entry.portion) bits.push(entry.portion);
  if (entry.hunger) bits.push(`Hambre ${entry.hunger}/5`);
  if (entry.kcal != null) bits.push(formatKcal(entry.kcal));
  if (bits.length) {
    const meta = document.createElement("p");
    meta.className = "entry-meta";
    meta.textContent = bits.join(" · ");
    li.append(meta);
  }

  if (entry.notes) {
    const notes = document.createElement("p");
    notes.className = "entry-notes";
    notes.textContent = entry.notes;
    li.append(notes);
  }

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-danger";
  del.textContent = "Eliminar";
  del.addEventListener("click", () => onDelete(entry.id));
  li.append(del);
  return { li, img };
}

function renderOverrides() {
  const id = envelope.data.nutrition.overrides_file_id;
  overridesCurrent.textContent = id || "Ninguno";
  if (document.activeElement !== overridesInput) overridesInput.value = id || "";
}

function renderMeals() {
  const id = envelope.data.meals.file_id;
  mealsCurrent.textContent = id || "Ninguno";
  if (document.activeElement !== mealsInput) mealsInput.value = id || "";
}

async function renderStorageStatus() {
  if (!storageStatus) return;
  let persisted = false;
  try {
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    persisted = false;
  }
  let usageText = "";
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      const used = formatBytes(estimate?.usage);
      const quota = formatBytes(estimate?.quota);
      if (used && quota) usageText = ` Uso aproximado: ${used} de ${quota}.`;
      else if (used) usageText = ` Uso aproximado: ${used}.`;
    }
  } catch {
    usageText = "";
  }
  const where = photos
    ? "Las fotos se guardan en IndexedDB de este navegador."
    : "IndexedDB no está disponible; las fotos siguen en el almacenamiento local de este navegador.";
  const persistText = persisted
    ? "El almacenamiento de este sitio es persistente."
    : "El almacenamiento de este sitio no está marcado como persistente.";
  const safari = "En iPhone y Safari, los datos de un sitio que no se usa durante 7 días pueden borrarse, salvo que instales la app en la pantalla de inicio.";
  storageStatus.textContent = `${where} ${persistText}${usageText} ${safari}`;
}

function confirmAction(message) {
  confirmText.textContent = message;
  confirmDialog.returnValue = "";
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener("close", () => {
      resolve(confirmDialog.returnValue === "ok");
    }, { once: true });
  });
}

async function onFile(file) {
  if (!file || busy) return;
  if (file.type && !file.type.startsWith("image/")) {
    clearPendingPhoto();
    updateSaveLabel();
    setError("No se pudo leer la imagen. Prueba con JPG o PNG.");
    cameraInput.value = "";
    galleryInput.value = "";
    return;
  }
  if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
  pendingFile = file;
  pendingPreviewUrl = URL.createObjectURL(file);
  previewImg.src = pendingPreviewUrl;
  preview.hidden = false;
  setError("");
  updateSaveLabel();
  cameraInput.value = "";
  galleryInput.value = "";
  toast("Foto lista. Confírmala o completa los campos.");
}

async function onSubmit(event) {
  event.preventDefault();
  if (busy || !ready) return;
  setError("");
  const file = pendingFile;
  const built = buildEntry({
    description: descriptionEl.value,
    portion: portionEl.value,
    notes: notesEl.value,
    kcal: kcalEl.value,
    meal_type: mealType,
    hunger,
    has_image: Boolean(file),
  });
  if (!built.ok) {
    const messages = {
      bad_kcal: "Escribe las kcal como número, o déjalas vacías.",
      bad_image: "No se pudo usar esa foto. Prueba con otra.",
      need_content: "Agrega una foto o escribe qué comiste.",
    };
    setError(messages[built.error] || messages.need_content);
    return;
  }
  setBusy(true);
  let storedKey = null;
  try {
    if (file) {
      const placed = await placeOriginalPhoto(file, built.entry.id, { photos });
      if (!placed.ok) {
        setError("No se pudo usar esa foto. Prueba con otra.");
        return;
      }
      if (placed.image_key) {
        storedKey = placed.image_key;
        built.entry.image_key = placed.image_key;
        delete built.entry.image_data_url;
      } else {
        built.entry.image_data_url = placed.image_data_url;
        delete built.entry.image_key;
      }
    }
    const next = structuredClone(envelope);
    next.data.entries.unshift(built.entry);
    if (!commit(next)) {
      if (storedKey && photos) {
        try { await photos.del(storedKey); } catch { /* ignore */ }
      }
      return;
    }
    resetForm();
    await renderToday();
    toast("Comida guardada.");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("today").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  } finally {
    setBusy(false);
  }
}

async function deletePhoto(key) {
  if (!key || !photos) return;
  try { await photos.del(key); } catch { /* the entry is already gone */ }
}

async function onDelete(id) {
  const ok = await confirmAction("¿Eliminar esta comida? No se puede deshacer.");
  if (!ok) return;
  const existing = envelope.data.entries.find((entry) => entry.id === id);
  const next = structuredClone(envelope);
  next.data.entries = next.data.entries.filter((entry) => entry.id !== id);
  if (!commit(next)) return;
  await deletePhoto(existing?.image_key);
  await renderToday();
  toast("Comida eliminada.");
}

function onSaveOverrides() {
  const id = parseFileId(overridesInput.value);
  const next = structuredClone(envelope);
  next.data.nutrition.overrides_file_id = id;
  if (!commit(next)) return;
  overridesInput.value = id || "";
  renderOverrides();
  toast(id ? "ID actualizado." : "ID quitado.");
}

function onClearOverrides() {
  const next = structuredClone(envelope);
  next.data.nutrition.overrides_file_id = null;
  if (!commit(next)) return;
  overridesInput.value = "";
  renderOverrides();
  toast("ID quitado.");
}

function onSaveMeals() {
  const id = parseFileId(mealsInput.value);
  const next = structuredClone(envelope);
  next.data.meals.file_id = id;
  if (!commit(next)) return;
  mealsInput.value = id || "";
  renderMeals();
  toast(id ? "ID actualizado." : "ID quitado.");
}

function onClearMeals() {
  const next = structuredClone(envelope);
  next.data.meals.file_id = null;
  if (!commit(next)) return;
  mealsInput.value = "";
  renderMeals();
  toast("ID quitado.");
}

async function onExport() {
  const next = structuredClone(envelope);
  if (!commit(next)) return;
  const exported = structuredClone(envelope);
  if (photos) {
    for (const entry of exported.data.entries) {
      if (!entry.image_key || isImageDataUrl(entry.image_data_url)) continue;
      try {
        const blob = await photos.get(entry.image_key);
        if (!blob) continue;
        const dataUrl = await readOriginalImageFile(blob);
        if (!isImageDataUrl(dataUrl)) continue;
        entry.image_data_url = dataUrl;
        delete entry.image_key;
      } catch {
        // Keep the key when the blob cannot be read back into the file.
      }
    }
  }
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "food-log-save.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Exportación lista.");
}

async function onImport(file) {
  if (!file) return;
  let text = "";
  try {
    text = await file.text();
  } catch {
    toast("No se pudo leer el archivo.");
    return;
  }
  const result = importEnvelope(text);
  if (!result.ok) {
    const messages = {
      wrong_app: "El archivo no es de food-log.",
      wrong_version: "Esta versión solo abre bitácoras schema_version 1 o 2.",
      invalid_json: "El archivo no es JSON válido.",
      invalid_envelope: "El archivo no tiene la forma de una bitácora.",
    };
    toast(messages[result.error] || "No se pudo importar.");
    return;
  }
  const previousKeys = envelope.data.entries.map((entry) => entry.image_key).filter(Boolean);
  if (!commit(result.envelope)) return;
  const migrated = await migrateEnvelope(envelope, { storage: localStorage, photos });
  envelope = migrated.envelope;
  const kept = new Set(envelope.data.entries.map((entry) => entry.image_key).filter(Boolean));
  for (const key of previousKeys) {
    if (!kept.has(key)) await deletePhoto(key);
  }
  resetForm();
  await renderToday();
  renderOverrides();
  renderMeals();
  const count = envelope.data.entries.length;
  toast(count === 1 ? "Bitácora importada · 1 comida." : `Bitácora importada · ${count} comidas.`);
}

async function onDrivePick() {
  driveStatus.hidden = false;
  driveStatus.textContent = "Abriendo Google Drive…";
  try {
    const fileId = await pickSpreadsheet();
    if (!fileId) {
      driveStatus.textContent = "No elegiste ningún archivo.";
      return;
    }
    const next = structuredClone(envelope);
    next.data.nutrition.overrides_file_id = fileId;
    if (!commit(next)) {
      driveStatus.textContent = "No se pudo guardar el ID.";
      return;
    }
    renderOverrides();
    driveStatus.textContent = "Archivo de Drive guardado.";
  } catch {
    driveStatus.textContent = "No se pudo abrir Google Drive. Revisa el client id y la conexión.";
  }
}

function setupDrive() {
  if (!GOOGLE_CLIENT_ID) return;
  driveNote.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary";
  button.id = "drive-pick";
  button.textContent = "Elegir hoja en Drive";
  driveNote.insertAdjacentElement("afterend", button);
  button.addEventListener("click", onDrivePick);
}

async function boot() {
  const stored = readEnvelope();
  envelope = stored.envelope;
  try {
    photos = await openPhotoStore();
  } catch {
    photos = null;
  }
  await requestPersistentStorage();
  if (photos && (stored.status === "ok" || stored.status === "empty")) {
    try {
      const migrated = await migrateEnvelope(envelope, { storage: localStorage, photos });
      envelope = migrated.envelope;
      if (migrated.moved > 0) toast("Fotos movidas al almacenamiento de este navegador.");
    } catch {
      // Keep the envelope as it was read. Data URLs stay until a later load can move them.
    }
  } else if (stored.status === "ok" || stored.status === "empty") {
    try {
      const migrated = await migrateEnvelope(envelope, { storage: localStorage, photos: null });
      envelope = migrated.envelope;
    } catch {
      // Schema stays as stored when the upgrade cannot be written.
    }
  }
  if (stored.status === "empty") commit(envelope);
  if (stored.status === "invalid") {
    toast("No se pudo leer la bitácora guardada. Si guardas de nuevo, se reemplaza.");
  }
  $("version").textContent = `food-log v${APP_VERSION}`;
  todayDate.textContent = formatLongDate(new Date());
  await renderToday();
  renderOverrides();
  renderMeals();
  updateSaveLabel();
  setupDrive();

  $("registrar").addEventListener("submit", onSubmit);
  descriptionEl.addEventListener("input", updateSaveLabel);
  cameraInput.addEventListener("change", () => onFile(cameraInput.files?.[0]));
  galleryInput.addEventListener("change", () => onFile(galleryInput.files?.[0]));
  $("remove-photo").addEventListener("click", () => {
    clearPendingPhoto();
    updateSaveLabel();
  });
  document.querySelectorAll("[data-meal]").forEach((button) => {
    button.addEventListener("click", () => {
      mealType = mealType === button.dataset.meal ? null : button.dataset.meal;
      syncChips();
    });
  });
  document.querySelectorAll("[data-hunger]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = Number(button.dataset.hunger);
      hunger = hunger === value ? null : value;
      syncChips();
    });
  });
  $("open-settings").addEventListener("click", async () => {
    renderOverrides();
    renderMeals();
    try {
      await renderStorageStatus();
    } catch {
      // The static note stays if the storage API fails.
    }
    if (!settingsDialog.open) settingsDialog.showModal();
  });
  $("open-backup").addEventListener("click", () => backupDialog.showModal());
  $("save-overrides").addEventListener("click", onSaveOverrides);
  $("clear-overrides").addEventListener("click", onClearOverrides);
  $("save-meals").addEventListener("click", onSaveMeals);
  $("clear-meals").addEventListener("click", onClearMeals);
  $("export-json").addEventListener("click", onExport);
  $("import-file").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    onImport(file);
  });
  window.addEventListener("storage", (event) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    const next = readEnvelope();
    if (next.status === "ok" || next.status === "empty") {
      envelope = next.envelope;
      renderToday();
      renderOverrides();
      renderMeals();
    }
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  ready = true;
  document.documentElement.dataset.ready = "1";
}

boot();
