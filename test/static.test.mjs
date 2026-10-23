import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("pages assets are relative and the picker client id is empty", () => {
  const files = {
    "index.html": read("index.html"),
    "css/styles.css": read("css/styles.css"),
    "js/app.js": read("js/app.js"),
    "js/config.js": read("js/config.js"),
    "js/drive.js": read("js/drive.js"),
    "js/meta.js": read("js/meta.js"),
    "js/progress.js": read("js/progress.js"),
    "manifest.json": read("manifest.json"),
    "sw.js": read("sw.js"),
  };
  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(source, /(?:src|href)\s*=\s*["']\//, `${name} has a root-absolute asset`);
    assert.doesNotMatch(source, /url\(\s*["']?\//, `${name} has a root-absolute css url`);
  }
  assert.match(files["index.html"], /href="css\/styles.css"/);
  assert.match(files["css/styles.css"], /\.preview\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
  assert.match(files["index.html"], /src="js\/app.js"/);
  assert.match(files["index.html"], /lang="es-CO"/);
  assert.equal(files["js/config.js"].includes('export const GOOGLE_CLIENT_ID = "";'), true);
  assert.match(files["js/config.js"], /DEFAULT_OVERRIDES_FILE_ID = null;/);
  assert.match(files["js/config.js"], /DEFAULT_MEALS_FILE_ID = null;/);
  assert.match(files["index.html"], /id="meals-file-id"/);
  assert.match(files["index.html"], /ID del archivo de comidas/);
  assert.match(files["index.html"], /food-log v0\.2\.6/);
  assert.match(files["index.html"], /IndexedDB de este navegador/);
  assert.match(files["index.html"], /7 días/);
  assert.match(files["index.html"], /pantalla de inicio/);
  assert.match(files["index.html"], /Google Picker necesita un client id más adelante/);
  assert.match(files["js/drive.js"], /auth\/drive\.file/);
  assert.match(files["js/config.js"], /APP_VERSION = "0\.2\.6"/);
  assert.match(files["js/config.js"], /SCHEMA_VERSION = 2/);
  assert.doesNotMatch(files["js/config.js"], /IMAGE_MAX_EDGE|IMAGE_JPEG_QUALITY/);
  assert.doesNotMatch(files["js/app.js"], /fetch\(/);
  assert.doesNotMatch(files["js/app.js"], /compressImageFile|shrinkDataUrlForDrive|demasiado pesada/);
  assert.match(files["js/app.js"], /readOriginalImageFile/);
  assert.match(files["js/app.js"], /No cabe en el almacenamiento del navegador/);
  const imageJs = read("js/image.js");
  const modelJs = read("js/model.js");
  assert.doesNotMatch(imageJs, /(?:src|href)\s*=\s*["']\//);
  assert.match(imageJs, /export function readOriginalImageFile/);
  assert.doesNotMatch(imageJs, /shrinkDataUrlForDrive|500 KB|Must not run unless|toBlob|canvas/);
  assert.doesNotMatch(imageJs, /1280|IMAGE_MAX_EDGE|IMAGE_JPEG_QUALITY/);
  assert.doesNotMatch(modelJs, /shrinkDataUrlForDrive|compressImageFile|4_000_000|4000000/);
  assert.match(read("sw.js"), /food-log-v0\.2\.6/);
  assert.match(read("sw.js"), /js\/meta\.js/);
  assert.match(read("sw.js"), /js\/progress\.js/);
  assert.match(files["manifest.json"], /"version": "0\.2\.6"/);
  assert.match(read("sw.js"), /js\/vendor\/idb-keyval\.js/);
  const storageJs = read("js/storage.js");
  assert.match(storageJs, /from "\.\/vendor\/idb-keyval\.js"/);
  assert.match(storageJs, /createStore/);
  assert.doesNotMatch(storageJs, /cdn\.|unpkg|jsdelivr|esm\.sh/);
  assert.doesNotMatch(files["js/app.js"], /cdn\.|unpkg|jsdelivr|esm\.sh/);
  const vendor = read("js/vendor/idb-keyval.js");
  assert.match(vendor, /Apache License, Version 2\.0/);
  assert.match(vendor, /export \{[^}]*\bcreateStore\b/);
  assert.match(read("js/vendor/idb-keyval.LICENSE"), /Apache License, Version 2\.0/);
  for (const name of ["js/app.js", "js/storage.js", "js/image.js", "js/model.js"]) {
    assert.doesNotMatch(read(name), /toBlob|drawImage|createImageBitmap|createElement\(\s*["']canvas["']\)/, name);
  }
});
