// food-log v0.2.2 — static config. No secrets belong here.
export const APP_ID = "food-log";
// New envelopes are schema 2 (photo blobs live in IndexedDB). Schema 1 is still read and migrated.
export const SCHEMA_VERSION = 2;
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2];
export const APP_VERSION = "0.2.2";
export const STORAGE_KEY = "food-log.save.v1";

// Tabla nutrición overrides Sheet. Empty by default: set the file id in Ajustes.
export const DEFAULT_OVERRIDES_FILE_ID = null;

// Sheet «Registro comidas». Empty by default: set the file id in Ajustes.
// food-log does not read the sheet or upload photos.
export const DEFAULT_MEALS_FILE_ID = null;

// Leave empty. When a real OAuth client id is set, Ajustes can open Google Picker
// once (scope drive.file) and store the chosen file id. Do not invent a client id.
export const GOOGLE_CLIENT_ID = "";

// Optional browser API key for Picker. Leave empty unless you have one; never commit a secret.
export const GOOGLE_API_KEY = "";
