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
  assert.match(files["index.html"], /Google Picker necesita un client id más adelante/);
  assert.match(files["js/drive.js"], /auth\/drive\.file/);
  assert.doesNotMatch(files["js/app.js"], /fetch\(/);
});
