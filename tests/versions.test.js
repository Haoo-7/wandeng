"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// The release we are converging on. Bumped 24 -> 25 with the gender-neutral
// onboarding copy plus gameplay honesty: dice faces carry the action/body,
// wheel segments carry their own prompts, board rolls a real die overlay.
const EXPECTED = 25;

const indexHtml = read("index.html");
const appJs = read("assets/app.js");
const swJs = read("sw.js");
const manifestText = read("manifest.webmanifest");

/** Pull every href/src in index.html that carries a ?v= token. */
function indexAssetRefs(html) {
  const refs = [];
  const re = /(?:href|src)\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const ref = m[1];
    const v = ref.match(/[?&]v=(\d+)/);
    if (v) refs.push({ ref, token: Number(v[1]) });
  }
  return refs;
}

/** Map "assets/app.js" -> 12 from a list of index.html refs. */
function tokenMap(refs) {
  const map = new Map();
  refs.forEach(({ ref, token }) => {
    const p = ref.split("?")[0].replace(/^\.\//, "");
    map.set(p, token);
  });
  return map;
}

test("every ?v= token on a local asset reference in index.html equals 25", () => {
  const refs = indexAssetRefs(indexHtml);
  assert.ok(
    refs.length > 0,
    "index.html must contain at least one ?v= asset reference"
  );
  refs.forEach(({ ref, token }) => {
    assert.equal(
      token,
      EXPECTED,
      `index.html reference "${ref}" uses ?v=${token}, expected ?v=${EXPECTED}`
    );
  });
});

test("index.html references a script assets/logic.js?v=25", () => {
  const re = /(?:src)\s*=\s*["']([^"']*logic\.js[^"']*)["']/g;
  const found = [];
  let m;
  while ((m = re.exec(indexHtml)) !== null) found.push(m[1]);

  assert.ok(
    found.length > 0,
    `index.html does not reference assets/logic.js at all (expected src="./assets/logic.js?v=${EXPECTED}")`
  );

  const withToken = found.find((r) => /[?&]v=(\d+)/.test(r));
  assert.ok(
    withToken !== undefined,
    `index.html references logic.js without a ?v= token (expected ?v=${EXPECTED})`
  );

  const token = Number(withToken.match(/[?&]v=(\d+)/)[1]);
  assert.equal(
    token,
    EXPECTED,
    `index.html logic.js reference "${withToken}" uses ?v=${token}, expected ?v=${EXPECTED}`
  );
});

test("assets/app.js registers a service worker with ?v=25", () => {
  const m = appJs.match(
    /serviceWorker[\s\S]*?\.register\(\s*["']([^"']+)["']/
  );
  assert.ok(
    m,
    `assets/app.js has no serviceWorker .register("...") call (expected "./sw.js?v=${EXPECTED}")`
  );

  const ref = m[1];
  const v = ref.match(/[?&]v=(\d+)/);
  assert.ok(
    v,
    `app.js registers "${ref}" with no ?v= token, expected ?v=${EXPECTED}`
  );
  assert.equal(
    Number(v[1]),
    EXPECTED,
    `app.js registers "${ref}" with ?v=${v[1]}, expected ?v=${EXPECTED}`
  );
});

test("sw.js declares a cache name whose trailing number is 25", () => {
  const m = swJs.match(/CACHE\s*=\s*["']([^"']+)["']/);
  assert.ok(m, "sw.js declares no CACHE constant");

  const name = m[1];
  const num = name.match(/(\d+)\s*$/);
  assert.ok(
    num,
    `sw.js cache name "${name}" has no trailing number, expected it to end in ${EXPECTED}`
  );
  assert.equal(
    Number(num[1]),
    EXPECTED,
    `sw.js cache name "${name}" ends with ${num[1]}, expected ${EXPECTED}`
  );
});

test("every ?v= token in sw.js's precache list matches the token in index.html", () => {
  const indexMap = tokenMap(indexAssetRefs(indexHtml));

  const entries = [];
  const re = /["']([^"']*\?v=(\d+)[^"']*)["']/g;
  let m;
  while ((m = re.exec(swJs)) !== null) {
    entries.push({ ref: m[1], token: Number(m[2]) });
  }
  assert.ok(entries.length > 0, "sw.js precache list contains no ?v= entries");

  entries.forEach(({ ref, token }) => {
    const p = ref.split("?")[0].replace(/^\.\//, "");
    const expected = indexMap.get(p);
    assert.ok(
      expected !== undefined,
      `sw.js precache "${ref}" has no corresponding reference in index.html`
    );
    assert.equal(
      token,
      expected,
      `sw.js precache "${ref}" uses ?v=${token}, but index.html uses ?v=${expected} for ${p}`
    );
  });
});

test("sw.js precache list includes assets/logic.js", () => {
  const has = /["'][^"']*assets\/logic\.js[^"']*["']/.test(swJs);
  assert.ok(
    has,
    `sw.js precache list does not include assets/logic.js (expected an entry like "./assets/logic.js?v=${EXPECTED}")`
  );
});

test("manifest.webmanifest parses as JSON and start_url is ./index.html", () => {
  // If the manifest is malformed, JSON.parse throws a self-explanatory
  // SyntaxError and this test fails right here.
  const manifest = JSON.parse(manifestText);
  assert.equal(
    manifest.start_url,
    "./index.html",
    `manifest start_url is ${JSON.stringify(manifest.start_url)}, expected "./index.html"`
  );
});

test("every file in the precache list actually exists on disk", () => {
  const files = [...swJs.matchAll(/"\.\/([^"]*)"/g)]
    .map((m) => m[1].split("?")[0])
    .filter(Boolean);
  assert.ok(files.length > 5, `expected a substantial precache list, parsed ${files.length} entries`);
  const missing = files.filter((rel) => !fs.existsSync(path.join(root, rel)));
  assert.deepEqual(
    missing,
    [],
    `sw.js precaches files that do not exist — cache.addAll would reject and silently kill offline: ${missing.join(", ")}`
  );
});
