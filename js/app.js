import { APP_VERSION, GOOGLE_CLIENT_ID, STORAGE_KEY } from "./config.js";
import { pickSpreadsheet } from "./drive.js";
import { compressImageFile } from "./image.js";
import {
  MEAL_LABELS,
  buildEntry,
  entriesForLocalDay,
  importEnvelope,
  parseFileId,
} from "./model.js";
import { persistEnvelope, readEnvelope } from "./storage.js";

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
const driveNote = $("drive-note");
const driveStatus = $("drive-status");
const toastEl = $("toast");
const settingsDialog = $("settings-dialog");
const backupDialog = $("backup-dialog");
const confirmDialog = $("confirm-dialog");
const confirmText = $("confirm-text");

let envelope = readEnvelope().envelope;
let pendingImage = null;
let mealType = null;
let hunger = null;
let busy = false;
let toastTimer = 0;

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
  saveBtn.textContent = pendingImage && !hasText ? "Confirmar foto" : "Guardar";
}

function resetForm() {
  pendingImage = null;
  mealType = null;
  hunger = null;
  descriptionEl.value = "";
  portionEl.value = "";
  notesEl.value = "";
  kcalEl.value = "";
  preview.hidden = true;
  previewImg.removeAttribute("src");
  cameraInput.value = "";
  galleryInput.value = "";
  setError("");
  syncChips();
  updateSaveLabel();
}

function renderToday() {
  const entries = entriesForLocalDay(envelope.data.entries, new Date());
  todayCount.textContent = entries.length === 1 ? "1 comida" : `${entries.length} comidas`;
  todayEmpty.hidden = entries.length > 0;
  todayList.replaceChildren();
  for (const entry of entries) todayList.append(renderEntry(entry));
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

  if (entry.image_data_url) {
    const img = document.createElement("img");
    img.className = "entry-photo";
    img.src = entry.image_data_url;
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
  return li;
}

function renderOverrides() {
  const id = envelope.data.nutrition.overrides_file_id;
  overridesCurrent.textContent = id || "Ninguno";
  if (document.activeElement !== overridesInput) overridesInput.value = id || "";
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
  if (file.size > 20 * 1024 * 1024) {
    setError("La imagen es demasiado pesada.");
    return;
  }
  setBusy(true);
  toast("Reduciendo foto…");
  try {
    pendingImage = await compressImageFile(file);
    previewImg.src = pendingImage;
    preview.hidden = false;
    setError("");
    updateSaveLabel();
    toast("Foto lista. Confírmala o completa los campos.");
  } catch {
    pendingImage = null;
    preview.hidden = true;
    previewImg.removeAttribute("src");
    updateSaveLabel();
    setError("No se pudo leer la imagen. Prueba con JPG o PNG.");
  } finally {
    cameraInput.value = "";
    galleryInput.value = "";
    setBusy(false);
  }
}

async function onSubmit(event) {
  event.preventDefault();
  if (busy) return;
  setError("");
  const built = buildEntry({
    description: descriptionEl.value,
    portion: portionEl.value,
    notes: notesEl.value,
    kcal: kcalEl.value,
    meal_type: mealType,
    hunger,
    image_data_url: pendingImage,
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
  try {
    const next = structuredClone(envelope);
    next.data.entries.unshift(built.entry);
    if (!commit(next)) return;
    resetForm();
    renderToday();
    toast("Comida guardada.");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("today").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  } finally {
    setBusy(false);
  }
}

async function onDelete(id) {
  const ok = await confirmAction("¿Eliminar esta comida? No se puede deshacer.");
  if (!ok) return;
  const next = structuredClone(envelope);
  next.data.entries = next.data.entries.filter((entry) => entry.id !== id);
  if (!commit(next)) return;
  renderToday();
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

function onExport() {
  const next = structuredClone(envelope);
  if (!commit(next)) return;
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
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
      wrong_version: "Esta versión solo abre bitácoras schema_version 1.",
      invalid_json: "El archivo no es JSON válido.",
      invalid_envelope: "El archivo no tiene la forma de una bitácora.",
    };
    toast(messages[result.error] || "No se pudo importar.");
    return;
  }
  if (!commit(result.envelope)) return;
  resetForm();
  renderToday();
  renderOverrides();
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

function boot() {
  const stored = readEnvelope();
  envelope = stored.envelope;
  if (stored.status === "empty") commit(envelope);
  if (stored.status === "invalid") {
    toast("No se pudo leer la bitácora guardada. Si guardas de nuevo, se reemplaza.");
  }
  $("version").textContent = `food-log v${APP_VERSION}`;
  todayDate.textContent = formatLongDate(new Date());
  renderToday();
  renderOverrides();
  updateSaveLabel();
  setupDrive();

  $("registrar").addEventListener("submit", onSubmit);
  descriptionEl.addEventListener("input", updateSaveLabel);
  cameraInput.addEventListener("change", () => onFile(cameraInput.files?.[0]));
  galleryInput.addEventListener("change", () => onFile(galleryInput.files?.[0]));
  $("remove-photo").addEventListener("click", () => {
    pendingImage = null;
    preview.hidden = true;
    previewImg.removeAttribute("src");
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
  $("open-settings").addEventListener("click", () => {
    renderOverrides();
    settingsDialog.showModal();
  });
  $("open-backup").addEventListener("click", () => backupDialog.showModal());
  $("save-overrides").addEventListener("click", onSaveOverrides);
  $("clear-overrides").addEventListener("click", onClearOverrides);
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
    }
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();
