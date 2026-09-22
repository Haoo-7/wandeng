"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const logic = require("../assets/logic.js");

const {
  keyOf,
  stableStringify,
  pickFrom,
  migrateUsed,
  migrateState,
  clampHeat,
  boundaryStatus,
  stepTile,
  serpentine,
  sanitizeBackup,
  poolFor,
  MAX_USED_PER_KEY,
} = logic;

/* ------------------------------------------------------------------ keyOf */

test("keyOf: distinguishes strings, numbers and objects", () => {
  assert.equal(keyOf("abc"), "s:abc");
  assert.equal(keyOf(7), "n:7");
  assert.equal(keyOf({ a: 1 }), "o:" + stableStringify({ a: 1 }));
});

test("keyOf: null and undefined collapse to the empty key", () => {
  assert.equal(keyOf(null), "");
  assert.equal(keyOf(undefined), "");
});

test("keyOf: structurally equal objects get the same key regardless of key order", () => {
  const a = JSON.parse('{"x":1,"y":[2,3],"z":{"k":true,"j":null}}');
  const b = JSON.parse('{"z":{"j":null,"k":true},"y":[2,3],"x":1}');
  assert.equal(keyOf(a), keyOf(b));
});

test("keyOf: changing any nested value changes the key", () => {
  const base = { x: 1, y: { z: 2 } };
  const changed = { x: 1, y: { z: 3 } };
  assert.notEqual(keyOf(base), keyOf(changed));
});

/* ------------------------------------------------------- stableStringify */

test("stableStringify: sorts object keys recursively and keeps array order", () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(stableStringify({ b: { d: 1, c: 2 }, a: [3, 1] }), '{"a":[3,1],"b":{"c":2,"d":1}}');
});

test("stableStringify: arrays keep positional order and undefined becomes null inside arrays", () => {
  assert.equal(stableStringify([1, undefined, 3]), "[1,null,3]");
});

/* ------------------------------------------------------------- pickFrom */

test("pickFrom: never mutates the used array it is given", () => {
  const used = ["s:a"];
  const snapshot = used.slice();
  pickFrom(["a", "b"], used, () => 0);
  assert.deepEqual(used, snapshot);
});

test("pickFrom: never returns an item whose key is already used", () => {
  const list = ["a", "b", "c"];
  let used = [];
  for (let i = 0; i < list.length; i++) {
    const before = used.slice();
    const out = pickFrom(list, used, () => 0);
    const k = keyOf(out.item);
    assert.ok(!before.includes(k), `pickFrom returned an already-used item on draw ${i + 1}`);
    used = out.used;
  }
});

test("pickFrom: a full sweep returns every item exactly once before repeating", () => {
  const list = ["a", "b", "c", "d"];
  let used = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const out = pickFrom(list, used, () => 0);
    used = out.used;
    seen.add(out.item);
  }
  assert.equal(seen.size, list.length);
});

test("pickFrom: resets the pool once every item has been used", () => {
  const list = ["a", "b"];
  let used = [];
  for (let i = 0; i < list.length; i++) used = pickFrom(list, used, () => 0).used;
  assert.equal(used.length, list.length);
  const out = pickFrom(list, used, () => 0);
  assert.equal(out.used.length, 1, "the pool must reset to a single fresh entry");
});

test("pickFrom: is deterministic for an injected rng", () => {
  const list = ["a", "b", "c"];
  assert.equal(pickFrom(list, [], () => 0).item, "a");
  assert.equal(pickFrom(list, [], () => 0.999).item, "c");
  assert.equal(pickFrom(list, [], () => 0.5).item, "b");
});

test("pickFrom: an empty list yields no item and an unchanged used list", () => {
  const out = pickFrom([], ["s:a"], () => 0);
  assert.equal(out.item, undefined);
  assert.deepEqual(out.used, ["s:a"]);
});

test("pickFrom: works for object items by key, not by reference", () => {
  const list = [{ q: "one" }, { q: "two" }];
  const parsed = JSON.parse(JSON.stringify(list)); // fresh identities, same content
  const out = pickFrom(parsed, [keyOf(list[0])], () => 0);
  assert.deepEqual(out.item, { q: "two" });
});

/* ------------------------------------------------------------ migrateUsed */

test("migrateUsed: non-object input becomes an empty record", () => {
  for (const raw of [null, undefined, "", "nope", 42, true, [], [1, 2]]) {
    assert.deepEqual(migrateUsed(raw), {}, `expected {} for ${JSON.stringify(raw)}`);
  }
});

test("migrateUsed: keys that are not <kind>-<gender> are dropped", () => {
  const out = migrateUsed({
    "truth-m": ["a"],
    "truth-both": ["b"],
    "truth": ["c"],
    "scene-x": ["d"],
    "": ["e"],
    "dare-f": ["f"],
  });
  assert.deepEqual(Object.keys(out).sort(), ["dare-f", "truth-m"]);
});

test("migrateUsed: non-array values are dropped, string entries are coerced through keyOf", () => {
  const out = migrateUsed({ "truth-m": ["a", "b"], "dare-m": "not-an-array", "scene-m": null });
  assert.deepEqual(out["truth-m"], ["s:a", "s:b"]);
  assert.equal(out["dare-m"], undefined);
  assert.equal(out["scene-m"], undefined);
});

test("migrateUsed: non-string entries are dropped", () => {
  const out = migrateUsed({ "truth-m": ["a", 1, null, true, undefined, "b"] });
  assert.deepEqual(out["truth-m"], ["s:a", "s:b"]);
});

test("migrateUsed: duplicates are collapsed keeping the most recent occurrence", () => {
  const out = migrateUsed({ "truth-m": ["a", "b", "a"] });
  assert.deepEqual(out["truth-m"], ["s:b", "s:a"]);
});

test("migrateUsed: caps each key from the tail and keeps the newest entries", () => {
  const many = Array.from({ length: MAX_USED_PER_KEY + 20 }, (_, i) => `item-${i}`);
  const out = migrateUsed({ "truth-m": many });
  assert.equal(out["truth-m"].length, MAX_USED_PER_KEY);
  assert.equal(out["truth-m"][MAX_USED_PER_KEY - 1], "s:" + many[many.length - 1]);
});

test("migrateUsed: a poisoned 10k-entry blob returns a bounded, string-only result", () => {
  const poisoned = { "truth-m": Array.from({ length: 10000 }, (_, i) => ({ i })) };
  const out = migrateUsed(poisoned);
  assert.deepEqual(out["truth-m"], [], "object entries are not strings and must be dropped");
});

/* ----------------------------------------------------------- migrateState */

test("migrateState: never throws on hostile input", () => {
  const defaults = { names: ["他", "她"], heat: 1, safeWord: "暂停", turn: 0, used: {}, boundary: {}, customPrompts: [] };
  for (const raw of ["", "null", "[]", "{", "42", '"x"', null, undefined, [], 7, true, () => {}]) {
    assert.doesNotThrow(() => migrateState(raw, defaults), `threw for ${String(raw)}`);
    const out = migrateState(raw, defaults);
    assert.deepEqual(out.state.names, ["他", "她"]);
    assert.equal(out.state.heat, 1);
    assert.ok(Array.isArray(out.warnings));
  }
});

test("migrateState: a legacy four-field shape is preserved verbatim", () => {
  const defaults = { names: ["他", "她"], heat: 0, safeWord: "暂停", turn: 0, used: {}, boundary: {}, customPrompts: [] };
  const legacy = { names: ["浩", "晚晚"], heat: 2, safeWord: "停", turn: 1 };
  const out = migrateState(legacy, defaults);
  assert.deepEqual(out.state.names, ["浩", "晚晚"]);
  assert.equal(out.state.heat, 2);
  assert.equal(out.state.safeWord, "停");
  assert.equal(out.state.turn, 1);
});

test("migrateState: names must be exactly two non-empty strings", () => {
  const defaults = { names: ["他", "她"], heat: 0, safeWord: "暂停", turn: 0, used: {}, boundary: {}, customPrompts: [] };
  for (const bad of [["only-one"], "a string", [1, 2], ["a", "b", "c"], ["", ""], null, {}]) {
    const out = migrateState({ names: bad }, defaults);
    assert.deepEqual(out.state.names, ["他", "她"], `names ${JSON.stringify(bad)} should fall back`);
  }
});

test("migrateState: names are trimmed and length-capped at 32 characters", () => {
  const defaults = { names: ["他", "她"], heat: 0, safeWord: "暂停", turn: 0, used: {}, boundary: {}, customPrompts: [] };
  const long = "x".repeat(80);
  const out = migrateState({ names: ["  浩  ", long] }, defaults);
  assert.deepEqual(out.state.names, ["浩", "x".repeat(32)]);
});

test("migrateState: heat, safeWord and turn fall back when wrong-typed", () => {
  const defaults = { names: ["他", "她"], heat: 1, safeWord: "暂停", turn: 0, used: {}, boundary: {}, customPrompts: [] };
  const out = migrateState({ heat: "2", safeWord: "", turn: 5 }, defaults);
  assert.equal(out.state.heat, 1);
  assert.equal(out.state.safeWord, "暂停");
  assert.equal(out.state.turn, 0);
  assert.ok(out.warnings.length >= 3, "each dropped field should warn");
});

test("migrateState: field-specific shapes are validated and warned about", () => {
  const defaults = { names: ["他", "她"], heat: 0, safeWord: "暂停", turn: 0, used: {}, boundary: {}, customPrompts: [] };
  const out = migrateState({ used: "nope", boundary: [], customPrompts: {} }, defaults);
  assert.deepEqual(out.state.used, {});
  assert.deepEqual(out.state.boundary, {});
  assert.deepEqual(out.state.customPrompts, []);
});

test("migrateState: used flows through migrateUsed", () => {
  const defaults = { names: ["他", "她"], heat: 0, safeWord: "暂停", turn: 0, used: {}, boundary: {}, customPrompts: [] };
  const out = migrateState({ used: { "truth-m": ["a", 1, "a"] } }, defaults);
  assert.deepEqual(out.state.used, { "truth-m": ["s:a"] });
});

test("migrateState: keys absent from defaults are dropped with a warning", () => {
  const defaults = { names: ["他", "她"], heat: 0, safeWord: "暂停", turn: 0, used: {}, boundary: {}, customPrompts: [] };
  const out = migrateState({ names: ["a", "b"], totallyUnknown: 123 }, defaults);
  assert.equal(out.state.totallyUnknown, undefined);
  assert.ok(out.warnings.some((w) => /totallyUnknown/.test(w)), "the dropped key must be named in warnings");
});

test("migrateState: returns a fresh object that does not alias defaults", () => {
  const defaults = { names: ["他", "她"], heat: 0, safeWord: "暂停", turn: 0, used: {}, boundary: {}, customPrompts: [] };
  const out = migrateState({}, defaults);
  out.state.names[0] = "MUTATED";
  out.state.used["truth-m"] = ["s:x"];
  assert.equal(defaults.names[0], "他");
  assert.deepEqual(defaults.used, {});
});

/* ------------------------------------------------------------- clampHeat */

test("clampHeat: clamps into 0..2 and rejects non-numbers", () => {
  assert.equal(clampHeat(-1), 0);
  assert.equal(clampHeat(0), 0);
  assert.equal(clampHeat(1), 1);
  assert.equal(clampHeat(2), 2);
  assert.equal(clampHeat(5), 2);
  assert.equal(clampHeat(NaN), 0);
  assert.equal(clampHeat(Infinity), 0);
  assert.equal(clampHeat("1"), 0);
  assert.equal(clampHeat(null), 0);
  assert.equal(clampHeat(undefined), 0);
});

/* -------------------------------------------------------- boundaryStatus */

const BOUNDARY_FIXTURE = [
  { id: "kiss", level: 1 },
  { id: "neck", level: 1 },
  { id: "tie", level: 3 },
];

const VERDICTS = {
  bothYes: "both-yes",
  hasMaybe: "has-maybe",
  anyNo: "any-no",
  unset: "unset",
};

test("boundaryStatus: both sides yes is a mutual yes", () => {
  const out = boundaryStatus({ kiss: [2, 2] }, BOUNDARY_FIXTURE);
  assert.equal(out.items[0].verdict, VERDICTS.bothYes);
  assert.deepEqual(out.items[0].levels, [2, 2]);
});

test("boundaryStatus: a yes with an unanswered side is not yet a mutual yes", () => {
  const out = boundaryStatus({ kiss: [2, null] }, BOUNDARY_FIXTURE);
  assert.equal(out.items[0].verdict, VERDICTS.unset);
});

test("boundaryStatus: maybe on either side without a refusal is a maybe", () => {
  assert.equal(boundaryStatus({ kiss: [1, 2] }, BOUNDARY_FIXTURE).items[0].verdict, VERDICTS.hasMaybe);
  assert.equal(boundaryStatus({ kiss: [1, 1] }, BOUNDARY_FIXTURE).items[0].verdict, VERDICTS.hasMaybe);
  assert.equal(boundaryStatus({ kiss: [1, null] }, BOUNDARY_FIXTURE).items[0].verdict, VERDICTS.hasMaybe);
});

test("boundaryStatus: a no on either side always wins", () => {
  assert.equal(boundaryStatus({ kiss: [0, 2] }, BOUNDARY_FIXTURE).items[0].verdict, VERDICTS.anyNo);
  assert.equal(boundaryStatus({ kiss: [0, 1] }, BOUNDARY_FIXTURE).items[0].verdict, VERDICTS.anyNo);
  assert.equal(boundaryStatus({ kiss: [0, null] }, BOUNDARY_FIXTURE).items[0].verdict, VERDICTS.anyNo);
  assert.equal(boundaryStatus({ kiss: [0, 0] }, BOUNDARY_FIXTURE).items[0].verdict, VERDICTS.anyNo);
});

test("boundaryStatus: counts tally every verdict and preserve item order", () => {
  const out = boundaryStatus({ kiss: [2, 2], neck: [1, 2], tie: [0, 2] }, BOUNDARY_FIXTURE);
  assert.deepEqual(out.items.map((i) => i.id), ["kiss", "neck", "tie"]);
  assert.deepEqual(out.items.map((i) => i.verdict), [VERDICTS.bothYes, VERDICTS.hasMaybe, VERDICTS.anyNo]);
  assert.deepEqual(out.counts, { bothYes: 1, hasMaybe: 1, anyNo: 1, unset: 0 });
});

test("boundaryStatus: unanswered items count as unset and tolerate a missing selection record", () => {
  const out = boundaryStatus(undefined, BOUNDARY_FIXTURE);
  assert.equal(out.counts.unset, BOUNDARY_FIXTURE.length);
  assert.deepEqual(out.items[0].levels, [null, null]);
});

/* -------------------------------------------------------------- stepTile */

const PLAIN = [{ kind: "start" }, { kind: "task" }, { kind: "task" }, { kind: "task" }, { kind: "end" }];

test("stepTile: a plain move advances by the given amount", () => {
  const out = stepTile(PLAIN, 1, 2);
  assert.equal(out.to, 3);
  assert.equal(out.kind, "task");
  assert.equal(out.moved, true);
});

test("stepTile: clamps at index 0", () => {
  const out = stepTile(PLAIN, 1, -5);
  assert.equal(out.to, 0);
  assert.equal(out.moved, true);
});

test("stepTile: clamps at the last index when overshooting", () => {
  const out = stepTile(PLAIN, 1, 99);
  assert.equal(out.to, PLAIN.length - 1);
  assert.equal(out.kind, "end");
});

test("stepTile: a zero move does not change position", () => {
  const out = stepTile(PLAIN, 2, 0);
  assert.equal(out.to, 2);
  assert.equal(out.moved, false);
});

test("stepTile: chains a forward tile into the tile it lands on", () => {
  const tiles = [{ kind: "start" }, { kind: "forward", by: 2 }, { kind: "task" }, { kind: "task" }, { kind: "end" }];
  const out = stepTile(tiles, 0, 1);
  assert.equal(out.to, 3);
  assert.equal(out.kind, "task");
  assert.deepEqual(out.path, [0, 1, 3]);
});

test("stepTile: a back tile moves backwards", () => {
  const tiles = [{ kind: "start" }, { kind: "task" }, { kind: "task" }, { kind: "back", by: 2 }, { kind: "end" }];
  const out = stepTile(tiles, 0, 3);
  assert.equal(out.to, 1);
  assert.equal(out.moved, true);
  assert.deepEqual(out.path, [0, 3, 1]);
});

test("stepTile: terminates on a forward/back/forward cycle", () => {
  const tiles = [{ kind: "start" }, { kind: "forward", by: 1 }, { kind: "back", by: 1 }, { kind: "task" }, { kind: "end" }];
  let out;
  assert.doesNotThrow(() => {
    out = stepTile(tiles, 0, 1);
  });
  assert.ok(Number.isInteger(out.to));
  assert.ok(out.path.length <= tiles.length * 2);
});

test("stepTile: terminates on a board where every tile is a forward", () => {
  const tiles = Array.from({ length: 8 }, () => ({ kind: "forward", by: 1 }));
  let out;
  assert.doesNotThrow(() => {
    out = stepTile(tiles, 0, 1);
  });
  assert.equal(out.to, tiles.length - 1);
});

test("stepTile: an empty board is handled without throwing", () => {
  assert.doesNotThrow(() => stepTile([], 0, 3));
});

/* ------------------------------------------------------------ serpentine */

test("serpentine: even rows run left to right and odd rows run right to left", () => {
  assert.deepEqual(serpentine(0, 6), { row: 0, col: 0 });
  assert.deepEqual(serpentine(5, 6), { row: 0, col: 5 });
  assert.deepEqual(serpentine(6, 6), { row: 1, col: 5 });
  assert.deepEqual(serpentine(11, 6), { row: 1, col: 0 });
  assert.deepEqual(serpentine(23, 6), { row: 3, col: 0 });
});

/* --------------------------------------------------------- sanitizeBackup */

test("sanitizeBackup: accepts a JSON object", () => {
  const out = sanitizeBackup('{"names":["a","b"]}');
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, { names: ["a", "b"] });
});

test("sanitizeBackup: rejects malformed text and non-object payloads", () => {
  for (const bad of ["", "{", "[]", "42", '"x"', "null", "not json"]) {
    const out = sanitizeBackup(bad);
    assert.equal(out.ok, false, `expected ok:false for ${JSON.stringify(bad)}`);
    assert.equal(typeof out.error, "string");
  }
});

/* ---------------------------------------------------------------- poolFor */

const POOL_DATA = {
  truth: {
    0: { both: ["t0-both"], m: ["t0-m"], f: ["t0-f"] },
    1: { both: ["t1-both"], m: ["t1-m"] },
    2: {},
  },
  wheel: {
    0: ["w0-a", "w0-b"],
    1: [],
    2: [],
  },
};

test("poolFor: concatenates both plus the matching gender, like the legacy packOf", () => {
  assert.deepEqual(poolFor("truth", 0, "m", POOL_DATA, []), ["t0-both", "t0-m"]);
  assert.deepEqual(poolFor("truth", 0, "f", POOL_DATA, []), ["t0-both", "t0-f"]);
  assert.deepEqual(poolFor("truth", 1, "f", POOL_DATA, []), ["t1-both"]);
});

test("poolFor: passes an array-shaped pack straight through", () => {
  assert.deepEqual(poolFor("wheel", 0, "m", POOL_DATA, []), ["w0-a", "w0-b"]);
});

test("poolFor: a missing pack yields an empty array rather than throwing", () => {
  assert.deepEqual(poolFor("nope", 0, "m", POOL_DATA, []), []);
  assert.deepEqual(poolFor("truth", 9, "m", POOL_DATA, []), []);
  assert.deepEqual(poolFor("truth", 2, "m", POOL_DATA, []), []);
});

test("poolFor: appends matching custom prompts and skips malformed ones", () => {
  const custom = [
    { kind: "truth", heat: 0, gender: "m", payload: "custom-m" },
    { kind: "truth", heat: 0, gender: "both", payload: "custom-both" },
    { kind: "truth", heat: 1, gender: "m", payload: "wrong-heat" },
    { kind: "dare", heat: 0, gender: "m", payload: "wrong-kind" },
    { kind: "truth", heat: 0, gender: "f", payload: "wrong-gender" },
    { kind: "truth", heat: 0, gender: "m" },
    null,
    "junk",
  ];
  assert.deepEqual(poolFor("truth", 0, "m", POOL_DATA, custom), ["t0-both", "t0-m", "custom-m", "custom-both"]);
});

test("poolFor: tolerates a missing custom prompt list and a missing data object", () => {
  assert.deepEqual(poolFor("truth", 0, "m", POOL_DATA), ["t0-both", "t0-m"]);
  assert.deepEqual(poolFor("truth", 0, "m", undefined, []), []);
});
