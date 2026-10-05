// food-log v0.2.0 — static config. No secrets belong here.
export const APP_ID = "food-log";
// New envelopes are schema 2 (photo blobs live in IndexedDB). Schema 1 is still read and migrated.
export const SCHEMA_VERSION = 2;
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2];
export const APP_VERSION = "0.2.0";
export const STORAGE_KEY = "food-log.save.v1";

// Tabla nutrición overrides Sheet. Seeded on a fresh save; the user can change or clear it.
export const DEFAULT_OVERRIDES_FILE_ID = "1B7WyOstF7xqgAgSS_7u46aFyGOFLYCtUm4O2Nw8xcKo";

// Sheet «Registro comidas». Seeded on a fresh save and when an older bitácora lacks data.meals.
// The user can change or clear it. food-log does not read the sheet or upload photos.
export const DEFAULT_MEALS_FILE_ID = "1YQC6LvXllCqRzUpNJ3guYn1GXcHI3Ra6y6LtgPCZlD0";

// Leave empty. When a real OAuth client id is set, Ajustes can open Google Picker
// once (scope drive.file) and store the chosen file id. Do not invent a client id.
export const GOOGLE_CLIENT_ID = "";

// Optional browser API key for Picker. Leave empty unless you have one; never commit a secret.
export const GOOGLE_API_KEY = "";
