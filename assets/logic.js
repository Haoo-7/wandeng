/* 晚灯 AFTER HOURS · 纯逻辑层
   无依赖、无 DOM、不读 window.WANDENG。经典脚本 + 守卫式双导出：
   file:// 直开时 Safari 不支持 ESM，所以不能写 import/export。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WANDENG_LOGIC = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // 单个 kind-gender 键下最多保留的去重键数，防止 used 随版本变更无限膨胀
  var MAX_USED_PER_KEY = 64;
  // used 的键是「一到两段小写」：truth-m / scene-f / plan-room
  var USED_KEY_RE = /^[a-z]+-[a-z]+$/;

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // 规范序列化：对象键递归排序，数组保持位置序。用于把结构相同的对象折成同一个键。
  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
      return (
        "[" +
        value
          .map(function (entry) {
            var serialized = stableStringify(entry);
            return serialized === undefined ? "null" : serialized;
          })
          .join(",") +
        "]"
      );
    }
    var keys = Object.keys(value).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var serializedValue = stableStringify(value[keys[i]]);
      if (serializedValue === undefined) continue;
      parts.push(JSON.stringify(keys[i]) + ":" + serializedValue);
    }
    return "{" + parts.join(",") + "}";
  }

  // 把任意题目折成一个稳定字符串键。对象不能靠引用比较：JSON.parse 之后引用就变了。
  function keyOf(item) {
    if (item === null || item === undefined) return "";
    if (typeof item === "string") return "s:" + item;
    if (typeof item === "number" && isFinite(item)) return "n:" + item;
    return "o:" + stableStringify(item);
  }

  function deepCopy(value) {
    if (Array.isArray(value)) return value.map(deepCopy);
    if (isPlainObject(value)) {
      var copy = {};
      var keys = Object.keys(value);
      for (var i = 0; i < keys.length; i++) copy[keys[i]] = deepCopy(value[keys[i]]);
      return copy;
    }
    return value;
  }

  function toInt(value) {
    return typeof value === "number" && isFinite(value) ? Math.trunc(value) : 0;
  }

  function clampIndex(value, last) {
    if (value < 0) return 0;
    if (value > last) return last;
    return value;
  }

  function dedupeAsKeys(entries) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      var key = typeof entries[i] === "string" ? entries[i] : keyOf(entries[i]);
      if (seen[key]) continue;
      seen[key] = true;
      out.push(key);
    }
    return out;
  }

  // 抽题：纯函数，不改传入的 used。整池抽完就重置，而不是把候选压成空集。
  function pickFrom(list, used, rng) {
    var random = typeof rng === "function" ? rng : Math.random;
    var items = Array.isArray(list) ? list : [];
    var previous = dedupeAsKeys(Array.isArray(used) ? used : []);

    if (!items.length) return { item: undefined, used: previous };

    var seen = Object.create(null);
    for (var i = 0; i < previous.length; i++) seen[previous[i]] = true;

    var pool = [];
    for (var j = 0; j < items.length; j++) {
      if (!seen[keyOf(items[j])]) pool.push(items[j]);
    }

    var exhausted = pool.length === 0;
    var source = exhausted ? items : pool;
    var next = exhausted ? [] : previous.slice();

    var index = Math.floor(random() * source.length);
    if (!(index >= 0)) index = 0;
    if (index >= source.length) index = source.length - 1;

    var item = source[index];
    next.push(keyOf(item));
    return { item: item, used: next };
  }

  function looksKeyed(value) {
    if (value.slice(0, 2) === "s:") return true;
    if (value.slice(0, 2) === "n:") {
      const rest = value.slice(2);
      return rest !== "" && isFinite(Number(rest));
    }
    if (value.slice(0, 2) === "o:") {
      try {
        JSON.parse(value.slice(2));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  function asKey(entry) {
    if (typeof entry !== "string") return keyOf(entry);
    return looksKeyed(entry) ? entry : keyOf(entry);
  }

  // 迁移历史 used：只认 <kind>-<gender> 键、数组值、字符串条目；去重取最近一次；从尾部截断。
  function migrateUsed(rawUsed) {
    if (!isPlainObject(rawUsed)) return {};
    var out = {};
    var keys = Object.keys(rawUsed);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!USED_KEY_RE.test(key)) continue;

      var value = rawUsed[key];
      if (!Array.isArray(value)) continue;

      var seen = Object.create(null);
      var kept = [];
      for (var j = value.length - 1; j >= 0; j--) {
        var entry = value[j];
        if (typeof entry !== "string") continue;
        var entryKey = asKey(entry);
        if (seen[entryKey]) continue;
        seen[entryKey] = true;
        kept.push(entryKey);
      }

      kept.reverse();
      if (kept.length > MAX_USED_PER_KEY) kept = kept.slice(kept.length - MAX_USED_PER_KEY);
      out[key] = kept;
    }

    return out;
  }

  function clampHeat(value) {
    if (typeof value !== "number" || !isFinite(value)) return 0;
    var rounded = Math.round(value);
    if (rounded < 0) return 0;
    if (rounded > 2) return 2;
    return rounded;
  }

  // 逐字段校验。返回 true 表示这个字段已被接管。
  function applyKnownField(key, rawValue, defaultValue, state, warnings) {
    switch (key) {
      case "names": {
        var ok =
          Array.isArray(rawValue) &&
          rawValue.length === 2 &&
          typeof rawValue[0] === "string" &&
          typeof rawValue[1] === "string" &&
          rawValue[0].trim() !== "" &&
          rawValue[1].trim() !== "";
        if (!ok) {
          warnings.push('"names" 必须是两个非空字符串');
          state[key] = deepCopy(defaultValue);
          break;
        }
        state[key] = [rawValue[0].trim().slice(0, 32), rawValue[1].trim().slice(0, 32)];
        break;
      }
      case "heat": {
        if (typeof rawValue !== "number" || !isFinite(rawValue)) {
          warnings.push('"heat" 必须是数字');
          state[key] = deepCopy(defaultValue);
          break;
        }
        state[key] = clampHeat(rawValue);
        break;
      }
      case "safeWord": {
        if (typeof rawValue !== "string" || rawValue.trim() === "") {
          warnings.push('"safeWord" 必须是非空字符串');
          state[key] = deepCopy(defaultValue);
          break;
        }
        state[key] = rawValue.trim().slice(0, 32);
        break;
      }
      case "turn": {
        if (rawValue !== 0 && rawValue !== 1) {
          warnings.push('"turn" 只能是 0 或 1');
          state[key] = deepCopy(defaultValue);
          break;
        }
        state[key] = rawValue;
        break;
      }
      case "used": {
        if (!isPlainObject(rawValue)) {
          warnings.push('"used" 必须是对象');
          state[key] = deepCopy(defaultValue);
          break;
        }
        state[key] = migrateUsed(rawValue);
        break;
      }
      case "boundary": {
        if (!isPlainObject(rawValue)) {
          warnings.push('"boundary" 必须是对象');
          state[key] = deepCopy(defaultValue);
          break;
        }
        state[key] = deepCopy(rawValue);
        break;
      }
      case "customPrompts": {
        if (!Array.isArray(rawValue)) {
          warnings.push('"customPrompts" 必须是数组');
          state[key] = deepCopy(defaultValue);
          break;
        }
        state[key] = deepCopy(rawValue);
        break;
      }
      case "board": {
        const pos = isPlainObject(rawValue) ? rawValue.pos : null;
        const valid =
          Array.isArray(pos) &&
          pos.length === 2 &&
          pos.every((p) => typeof p === "number" && isFinite(p) && p >= 0) &&
          typeof rawValue.theme === "string" &&
          typeof rawValue.winner === "number" &&
          isFinite(rawValue.winner);
        if (!valid) {
          warnings.push('"board" 形状不符');
          state[key] = deepCopy(defaultValue);
          break;
        }
        state[key] = { pos: [pos[0], pos[1]], theme: rawValue.theme, winner: rawValue.winner };
        break;
      }
      default:
        return false;
    }
    return true;
  }

  function shapeMatches(rawValue, defaultValue) {
    if (Array.isArray(defaultValue)) return Array.isArray(rawValue);
    if (isPlainObject(defaultValue)) return isPlainObject(rawValue);
    if (defaultValue === null) return rawValue === null;
    return typeof rawValue === typeof defaultValue;
  }

  // 迁移状态：任何输入都不许抛错；每个字段独立兜底，坏字段不污染好字段。
  function migrateState(raw, defaults) {
    var warnings = [];
    var defs = isPlainObject(defaults) ? defaults : {};
    var source = isPlainObject(raw) ? raw : {};

    if (raw !== undefined && raw !== null && !isPlainObject(raw)) {
      warnings.push("状态载荷不是对象，全部回落到默认值");
    }

    var state = {};
    var keys = Object.keys(defs);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];

      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        state[key] = deepCopy(defs[key]);
        continue;
      }

      if (applyKnownField(key, source[key], defs[key], state, warnings)) continue;

      if (shapeMatches(source[key], defs[key])) {
        state[key] = deepCopy(source[key]);
        continue;
      }

      warnings.push('"' + key + '" 形状不符，已重置为默认值');
      state[key] = deepCopy(defs[key]);
    }

    var sourceKeys = Object.keys(source);
    for (var k = 0; k < sourceKeys.length; k++) {
      if (!Object.prototype.hasOwnProperty.call(defs, sourceKeys[k])) {
        warnings.push('已丢弃未知字段 "' + sourceKeys[k] + '"');
      }
    }

    return { state: state, warnings: warnings };
  }

  function readLevel(value) {
    return value === 0 || value === 1 || value === 2 ? value : null;
  }

  function verdictFor(a, b) {
    if (a === 2 && b === 2) return "both-yes";
    if ((a === 1 || b === 1) && a !== 0 && b !== 0) return "has-maybe";
    if (a === 0 || b === 0) return "any-no";
    return "unset";
  }

  function boundaryStatus(selections, items) {
    var chosen = isPlainObject(selections) ? selections : {};
    var list = Array.isArray(items) ? items : [];
    var outItems = [];
    var counts = { bothYes: 0, hasMaybe: 0, anyNo: 0, unset: 0 };

    for (var i = 0; i < list.length; i++) {
      var item = isPlainObject(list[i]) ? list[i] : {};
      var pair = chosen[item.id];
      var a = readLevel(Array.isArray(pair) ? pair[0] : null);
      var b = readLevel(Array.isArray(pair) ? pair[1] : null);
      var verdict = verdictFor(a, b);

      if (verdict === "both-yes") counts.bothYes++;
      else if (verdict === "has-maybe") counts.hasMaybe++;
      else if (verdict === "any-no") counts.anyNo++;
      else counts.unset++;

      outItems.push({ id: item.id, level: item.level, levels: [a, b], verdict: verdict });
    }

    return { items: outItems, counts: counts };
  }

  function movementDelta(tile) {
    if (!isPlainObject(tile)) return null;
    if (tile.kind !== "forward" && tile.kind !== "back") return null;
    var magnitude = Math.abs(toInt(tile.by));
    return tile.kind === "back" ? -magnitude : magnitude;
  }

  // 走格：前进/后退格会连锁触发，靠 visited + 步数上限保证一定收敛，绝不进死循环。
  function stepTile(tiles, from, by) {
    var list = Array.isArray(tiles) ? tiles : [];
    var last = list.length - 1;
    if (last < 0) return { to: -1, path: [], kind: "", moved: false };

    var start = clampIndex(toInt(from), last);
    var visited = Object.create(null);
    visited[start] = true;

    var path = [start];
    var index = start;
    var delta = toInt(by);
    var maxSteps = list.length * 2;
    var steps = 0;

    while (steps < maxSteps) {
      steps++;

      var next = clampIndex(index + delta, last);
      if (next !== index) {
        if (visited[next]) break;
        index = next;
        visited[index] = true;
        path.push(index);
      }

      var chained = movementDelta(list[index]);
      if (chained === null) break;
      delta = chained;
    }

    var finalTile = isPlainObject(list[index]) ? list[index] : {};
    return {
      to: index,
      path: path,
      kind: typeof finalTile.kind === "string" ? finalTile.kind : "",
      moved: index !== start,
    };
  }

  function serpentine(index, cols) {
    var width = typeof cols === "number" && cols > 0 ? Math.floor(cols) : 1;
    var position = toInt(index);
    if (position < 0) position = 0;
    var row = Math.floor(position / width);
    var offset = position % width;
    return { row: row, col: row % 2 === 1 ? width - 1 - offset : offset };
  }

  function sanitizeBackup(text) {
    try {
      var value = JSON.parse(text);
      if (!isPlainObject(value)) return { ok: false, error: "载荷不是 JSON 对象" };
      return { ok: true, value: value };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : "JSON 解析失败" };
    }
  }

  // 题目池的唯一来源：与旧的 packOf 语义一致，再追加命中的自定义题。
  function poolFor(kind, heat, gender, data, customPrompts) {
    var out = [];
    var pack = isPlainObject(data) ? data[kind] : undefined;
    var raw = isPlainObject(pack) ? pack[heat] : undefined;

    if (Array.isArray(raw)) {
      out = raw.slice();
    } else if (isPlainObject(raw)) {
      var both = Array.isArray(raw.both) ? raw.both : [];
      var gendered = Array.isArray(raw[gender]) ? raw[gender] : [];
      out = both.concat(gendered);
    }

    var custom = Array.isArray(customPrompts) ? customPrompts : [];
    for (var i = 0; i < custom.length; i++) {
      var entry = custom[i];
      if (!isPlainObject(entry)) continue;
      if (entry.kind !== kind || entry.heat !== heat) continue;
      if (entry.gender !== gender && entry.gender !== "both") continue;
      if (entry.payload === undefined) continue;
      out.push(entry.payload);
    }

    return out;
  }

  return {
    MAX_USED_PER_KEY: MAX_USED_PER_KEY,
    stableStringify: stableStringify,
    keyOf: keyOf,
    pickFrom: pickFrom,
    migrateUsed: migrateUsed,
    migrateState: migrateState,
    clampHeat: clampHeat,
    boundaryStatus: boundaryStatus,
    stepTile: stepTile,
    serpentine: serpentine,
    sanitizeBackup: sanitizeBackup,
    poolFor: poolFor,
  };
});
