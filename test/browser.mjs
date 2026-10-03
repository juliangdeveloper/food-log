import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHEET = "1B7WyOstF7xqgAgSS_7u46aFyGOFLYCtUm4O2Nw8xcKo";
const MEALS = "1YQC6LvXllCqRzUpNJ3guYn1GXcHI3Ra6y6LtgPCZlD0";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
};

function png(width, height) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 220)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = readFileSync(filePath);
      res.writeHead(200, { "content-type": TYPES[extname(filePath)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function loadPuppeteer() {
  try {
    const mod = await import("puppeteer-core");
    return mod.default || mod;
  } catch {
    return null;
  }
}

test("food log works in the browser for both entry modes", { timeout: 120000 }, async (t) => {
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    t.skip("puppeteer-core is not installed");
    return;
  }
  const server = await startServer();
  const port = server.address().port;
  const photoPath = join(tmpdir(), `food-log-${port}.png`);
  const importPath = join(tmpdir(), `food-log-${port}.json`);
  const downloadDir = join(tmpdir(), `food-log-dl-${port}`);
  mkdirSync(downloadDir, { recursive: true });
  writeFileSync(photoPath, png(2000, 20));

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  try {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForSelector("#today-list");

    const shell = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      version: document.getElementById("version").textContent,
      drive: document.getElementById("drive-note").textContent,
      scripts: [...document.scripts].map((script) => script.src),
      styles: [...document.querySelectorAll("link[rel=stylesheet]")].map((link) => link.getAttribute("href")),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      save: JSON.parse(localStorage.getItem("food-log.save.v1")),
    }));
    assert.equal(shell.lang, "es-CO");
    assert.equal(shell.version, "food-log v0.1.1");
    assert.match(shell.drive, /client id/i);
    assert.deepEqual(shell.styles, ["css/styles.css"]);
    assert.equal(shell.scripts.some((src) => /googleapis|accounts\.google/.test(src)), false);
    assert.equal(shell.overflow, false);
    assert.equal(shell.save.app_id, "food-log");
    assert.equal(shell.save.schema_version, 1);
    assert.deepEqual(shell.save.data.entries, []);
    assert.equal(shell.save.data.nutrition.overrides_file_id, SHEET);
    assert.equal(shell.save.data.meals.file_id, MEALS);
    assert.deepEqual(shell.save.data.settings, {});

    await page.click("#save-entry");
    const emptyError = await page.$eval("#form-error", (el) => el.textContent);
    assert.match(emptyError, /foto o escribe/);
    assert.equal(await entryCount(page), 0);

    await page.click('[data-meal="almuerzo"]');
    await page.type("#description", "Bandeja paisa");
    await page.type("#portion", "1 plato");
    await page.click('[data-hunger="4"]');
    await page.type("#notes", "sin aguacate");
    await page.type("#kcal", "850,5");
    await page.click("#save-entry");
    await page.waitForFunction(() => document.querySelectorAll("#today-list .entry").length === 1);

    const textEntry = await page.evaluate(() => {
      const save = JSON.parse(localStorage.getItem("food-log.save.v1"));
      return {
        entry: save.data.entries[0],
        card: document.querySelector("#today-list .entry").innerText,
        description: document.getElementById("description").value,
      };
    });
    assert.equal(textEntry.entry.description, "Bandeja paisa");
    assert.equal(textEntry.entry.image_data_url, null);
    assert.equal(textEntry.entry.meal_type, "almuerzo");
    assert.equal(textEntry.entry.portion, "1 plato");
    assert.equal(textEntry.entry.hunger, 4);
    assert.equal(textEntry.entry.notes, "sin aguacate");
    assert.equal(textEntry.entry.kcal, 850.5);
    assert.equal(textEntry.entry.created_at, textEntry.entry.updated_at);
    assert.match(textEntry.card, /Bandeja paisa/);
    assert.match(textEntry.card, /Almuerzo/);
    assert.match(textEntry.card, /850,5 kcal/);
    assert.equal(textEntry.description, "");

    await page.click("#today-list .btn-danger");
    await page.waitForSelector("#confirm-dialog[open]");
    await page.click("#confirm-ok");
    await page.waitForFunction(() => document.querySelectorAll("#today-list .entry").length === 0);

    const gallery = await page.$("#gallery-input");
    await gallery.uploadFile(photoPath);
    await page.waitForFunction(() => document.getElementById("save-entry").textContent === "Confirmar foto");
    await page.click("#save-entry");
    await page.waitForFunction(() => document.querySelectorAll("#today-list .entry").length === 1);
    const photo = await page.evaluate(async () => {
      const save = JSON.parse(localStorage.getItem("food-log.save.v1"));
      const entry = save.data.entries[0];
      const img = new Image();
      img.src = entry.image_data_url;
      await img.decode();
      return {
        description: entry.description,
        head: entry.image_data_url.slice(0, 23),
        width: img.naturalWidth,
        height: img.naturalHeight,
        title: document.querySelector(".entry-title").textContent,
      };
    });
    assert.equal(photo.description, "");
    assert.equal(photo.head.startsWith("data:image/jpeg;base64,"), true);
    assert.equal(photo.width, 1280);
    assert.ok(photo.height < 20);
    assert.equal(photo.title, "Foto");

    await page.click("#open-settings");
    await page.waitForSelector("#settings-dialog[open]");
    assert.equal(await page.$eval("#overrides-file-id", (el) => el.value), SHEET);
    await page.click("#clear-overrides");
    await page.waitForFunction(() => {
      const save = JSON.parse(localStorage.getItem("food-log.save.v1"));
      return save.data.nutrition.overrides_file_id === null;
    });
    await page.$eval("#overrides-file-id", (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, `https://docs.google.com/spreadsheets/d/${SHEET}/edit`);
    await page.click("#save-overrides");
    await page.waitForFunction((id) => {
      const save = JSON.parse(localStorage.getItem("food-log.save.v1"));
      return save.data.nutrition.overrides_file_id === id;
    }, {}, SHEET);
    assert.equal(await page.$eval("#meals-file-id", (el) => el.value), MEALS);
    await page.click("#clear-meals");
    await page.waitForFunction(() => {
      const save = JSON.parse(localStorage.getItem("food-log.save.v1"));
      return save.data.meals.file_id === null;
    });
    await page.$eval("#meals-file-id", (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, `https://docs.google.com/spreadsheets/d/${MEALS}/edit`);
    await page.click("#save-meals");
    await page.waitForFunction((id) => {
      const save = JSON.parse(localStorage.getItem("food-log.save.v1"));
      return save.data.meals.file_id === id;
    }, {}, MEALS);
    await page.click("#settings-dialog button[value='cancel']");

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const imported = {
      app_id: "food-log",
      schema_version: 1,
      saved_at: new Date().toISOString(),
      data: {
        entries: [
          {
            id: "ayer",
            created_at: yesterday.toISOString(),
            updated_at: yesterday.toISOString(),
            meal_type: "cena",
            description: "Sopa de ayer",
            portion: "",
            hunger: null,
            notes: "",
            kcal: null,
            image_data_url: null,
          },
          {
            id: "hoy",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            meal_type: "snack",
            description: "Mandarina",
            portion: "1",
            hunger: 2,
            notes: "",
            kcal: 40,
            image_data_url: null,
          },
        ],
        nutrition: { overrides_file_id: SHEET },
        settings: {},
      },
    };
    writeFileSync(importPath, JSON.stringify(imported));
    const importer = await page.$("#import-file");
    await importer.uploadFile(importPath);
    await page.waitForFunction(() => document.querySelector(".entry-title")?.textContent === "Mandarina");
    const afterImport = await page.evaluate(() => {
      const save = JSON.parse(localStorage.getItem("food-log.save.v1"));
      return {
        stored: save.data.entries.map((entry) => entry.description),
        visible: [...document.querySelectorAll(".entry-title")].map((el) => el.textContent),
        meals: save.data.meals.file_id,
      };
    });
    assert.deepEqual(afterImport.visible, ["Mandarina"]);
    assert.deepEqual(afterImport.stored.slice().sort(), ["Mandarina", "Sopa de ayer"]);
    assert.equal(afterImport.meals, MEALS);

    const client = await page.createCDPSession();
    await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
    await page.click("#open-backup");
    await page.waitForSelector("#backup-dialog[open]");
    await page.click("#export-json");
    const exportedName = await waitForFile(downloadDir);
    const exported = JSON.parse(readFileSync(join(downloadDir, exportedName), "utf8"));
    assert.equal(exported.app_id, "food-log");
    assert.equal(exported.schema_version, 1);
    assert.equal(exported.data.entries.length, 2);
    assert.equal(exported.data.meals.file_id, MEALS);

    await page.setViewport({ width: 1280, height: 800 });
    const desktopOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    ));
    assert.equal(desktopOverflow, false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

function entryCount(page) {
  return page.$$eval("#today-list .entry", (nodes) => nodes.length);
}

async function waitForFile(dir) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const names = readdirSync(dir).filter((name) => name.endsWith(".json") && !name.endsWith(".crdownload"));
    if (names.length) return names[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`export file missing in ${dir}: ${readdirSync(dir).join(",")}`);
}
