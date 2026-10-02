// food-log v0.1.0 — static config. No secrets belong here.
export const APP_ID = "food-log";
export const SCHEMA_VERSION = 1;
export const APP_VERSION = "0.1.0";
export const STORAGE_KEY = "food-log.save.v1";

// Tabla nutrición overrides Sheet. Seeded on a fresh save; the user can change or clear it.
export const DEFAULT_OVERRIDES_FILE_ID = "1B7WyOstF7xqgAgSS_7u46aFyGOFLYCtUm4O2Nw8xcKo";

// Leave empty. When a real OAuth client id is set, Ajustes can open Google Picker
// once (scope drive.file) and store the chosen file id. Do not invent a client id.
export const GOOGLE_CLIENT_ID = "";

// Optional browser API key for Picker. Leave empty unless you have one; never commit a secret.
export const GOOGLE_API_KEY = "";

export const IMAGE_MAX_EDGE = 1280;
export const IMAGE_JPEG_QUALITY = 0.7;
