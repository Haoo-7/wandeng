"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Load assets/data.js without a browser: read it as text and evaluate it in a
// sandbox, then grab the object it assigns to window.
const dataPath = path.join(__dirname, "..", "assets", "data.js");
const src = fs.readFileSync(dataPath, "utf8");
const sandbox = {};
new Function("window", src)(sandbox);
const W = sandbox.WANDENG;

const TILE_KINDS = [
  "start",
  "task",
  "forward",
  "back",
  "cost",
  "skip",
  "together",
  "end",
];

const HEAT_PACKS = [
  "truth",
  "dare",
  "wheel",
  "scenes",
  "choices",
  "timers",
  "combo",
  "penalties",
  "dice",
];

test("data.js exposes window.WANDENG as an object", () => {
  assert.ok(W && typeof W === "object", "window.WANDENG must be an object");
});

test("boundary is a non-empty array of unique, well-formed entries", () => {
  assert.ok(Array.isArray(W.boundary), "W.boundary must be an array");
  assert.ok(W.boundary.length > 0, "W.boundary must be non-empty");

  const seen = new Set();
  W.boundary.forEach((entry, i) => {
    assert.ok(
      entry && typeof entry === "object",
      `boundary[${i}] must be an object`
    );
    assert.ok(
      typeof entry.id === "string" && entry.id.length > 0,
      `boundary[${i}] id must be a non-empty string, got ${JSON.stringify(entry.id)}`
    );
    assert.ok(
      !seen.has(entry.id),
      `boundary[${i}] has duplicate id "${entry.id}"`
    );
    seen.add(entry.id);
    assert.ok(
      entry.level === 1 || entry.level === 2 || entry.level === 3,
      `boundary[${i}] (id "${entry.id}") level must be 1, 2 or 3, got ${JSON.stringify(entry.level)}`
    );
    assert.ok(
      typeof entry.zh === "string" && entry.zh.length > 0,
      `boundary[${i}] (id "${entry.id}") zh must be a non-empty string`
    );
  });
});

test("board.size is 24 and tiles has length 24", () => {
  assert.ok(W.board && typeof W.board === "object", "W.board must be an object");
  assert.equal(W.board.size, 24, "W.board.size must be 24");
  assert.ok(Array.isArray(W.board.tiles), "W.board.tiles must be an array");
  assert.equal(
    W.board.tiles.length,
    24,
    `W.board.tiles must have length 24, got ${W.board.tiles.length}`
  );
});

test("every tile kind is one of the allowed kinds", () => {
  W.board.tiles.forEach((tile, i) => {
    assert.ok(tile && typeof tile === "object", `tiles[${i}] must be an object`);
    assert.ok(
      TILE_KINDS.includes(tile.kind),
      `tiles[${i}] kind ${JSON.stringify(tile.kind)} is not one of: ${TILE_KINDS.join(", ")}`
    );
  });
});

test("every forward/back tile carries an integer by >= 1", () => {
  W.board.tiles.forEach((tile, i) => {
    if (tile.kind === "forward" || tile.kind === "back") {
      assert.ok(
        Number.isInteger(tile.by),
        `tiles[${i}] (${tile.kind}) by must be an integer, got ${JSON.stringify(tile.by)}`
      );
      assert.ok(
        tile.by >= 1,
        `tiles[${i}] (${tile.kind}) by must be >= 1, got ${tile.by}`
      );
    }
  });
});

test("exactly one start tile at index 0 and one end tile at index 23", () => {
  const starts = [];
  const ends = [];
  W.board.tiles.forEach((tile, i) => {
    if (tile.kind === "start") starts.push(i);
    if (tile.kind === "end") ends.push(i);
  });

  assert.equal(
    starts.length,
    1,
    `expected exactly one start tile, found ${starts.length} at index(es) ${starts.join(", ")}`
  );
  assert.equal(starts[0], 0, `start tile must be at index 0, found at index ${starts[0]}`);

  assert.equal(
    ends.length,
    1,
    `expected exactly one end tile, found ${ends.length} at index(es) ${ends.join(", ")}`
  );
  assert.equal(ends[0], 23, `end tile must be at index 23, found at index ${ends[0]}`);
});

test("themes is a non-empty array of unique ids with name and hint", () => {
  assert.ok(Array.isArray(W.board.themes), "W.board.themes must be an array");
  assert.ok(W.board.themes.length > 0, "W.board.themes must be non-empty");

  const seen = new Set();
  W.board.themes.forEach((theme, i) => {
    assert.ok(
      theme && typeof theme === "object",
      `themes[${i}] must be an object`
    );
    assert.ok(
      typeof theme.id === "string" && theme.id.length > 0,
      `themes[${i}] id must be a non-empty string`
    );
    assert.ok(
      !seen.has(theme.id),
      `themes[${i}] has duplicate id "${theme.id}"`
    );
    seen.add(theme.id);
    assert.ok(
      typeof theme.name === "string" && theme.name.length > 0,
      `themes[${i}] (id "${theme.id}") name must be a non-empty string`
    );
    assert.ok(
      typeof theme.hint === "string" && theme.hint.length > 0,
      `themes[${i}] (id "${theme.id}") hint must be a non-empty string`
    );
  });
});

test("every heat-keyed pack exposes heat keys 0, 1 and 2", () => {
  HEAT_PACKS.forEach((pack) => {
    if (!W[pack]) return;
    [0, 1, 2].forEach((heat) => {
      assert.ok(
        Object.prototype.hasOwnProperty.call(W[pack], heat),
        `W.${pack} is missing heat key ${heat}`
      );
    });
  });
});

test("plans exposes the two activity piles with well-formed cards", () => {
  assert.ok(W.plans && typeof W.plans === "object", "W.plans must be an object");
  ["room", "out"].forEach((pile) => {
    const cards = W.plans[pile];
    assert.ok(Array.isArray(cards) && cards.length > 0, `W.plans.${pile} must be a non-empty array`);
    const seen = new Set();
    cards.forEach((card, i) => {
      assert.ok(card && typeof card === "object", `plans.${pile}[${i}] must be an object`);
      assert.ok(typeof card.id === "string" && card.id, `plans.${pile}[${i}] needs an id`);
      assert.ok(!seen.has(card.id), `plans.${pile} duplicate id "${card.id}"`);
      seen.add(card.id);
      assert.ok(typeof card.title === "string" && card.title.trim(), `plans.${pile}[${i}] (${card.id}) needs a title`);
      assert.ok(typeof card.desc === "string" && card.desc.trim(), `plans.${pile}[${i}] (${card.id}) needs a desc`);
      assert.equal(typeof card.foil, "boolean", `plans.${pile}[${i}] (${card.id}) foil must be a boolean`);
    });
  });
});

test("board themes are well-formed and the tile kinds cover what the renderer handles", () => {
  const rendered = ["start", "task", "forward", "back", "cost", "skip", "together", "end"];
  const used = new Set(W.board.tiles.map((t) => t.kind));
  used.forEach((kind) => assert.ok(rendered.includes(kind), `renderer has no branch for tile kind "${kind}"`));
});
