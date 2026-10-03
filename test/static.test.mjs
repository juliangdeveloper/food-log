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
    "manifest.json": read("manifest.json"),
    "sw.js": read("sw.js"),
  };
  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(source, /(?:src|href)\s*=\s*["']\//, `${name} has a root-absolute asset`);
    assert.doesNotMatch(source, /url\(\s*["']?\//, `${name} has a root-absolute css url`);
  }
  assert.match(files["index.html"], /href="css\/styles.css"/);
  assert.match(files["index.html"], /src="js\/app.js"/);
  assert.match(files["index.html"], /lang="es-CO"/);
  assert.equal(files["js/config.js"].includes('export const GOOGLE_CLIENT_ID = "";'), true);
  assert.match(files["js/config.js"], /1B7WyOstF7xqgAgSS_7u46aFyGOFLYCtUm4O2Nw8xcKo/);
  assert.match(files["js/config.js"], /1YQC6LvXllCqRzUpNJ3guYn1GXcHI3Ra6y6LtgPCZlD0/);
  assert.match(files["index.html"], /id="meals-file-id"/);
  assert.match(files["index.html"], /ID del archivo de comidas/);
  assert.match(files["index.html"], /food-log v0\.1\.3/);
  assert.match(files["index.html"], /Google Picker necesita un client id más adelante/);
  assert.match(files["js/drive.js"], /auth\/drive\.file/);
  assert.match(files["js/config.js"], /APP_VERSION = "0\.1\.3"/);
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
  assert.match(read("sw.js"), /food-log-v0\.1\.3/);
});
