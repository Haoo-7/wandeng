(() => {
  const KEY = "wandeng-state-v3";
  const LEGACY_KEYS = ["wandeng-state-v2"];
  const data = window.WANDENG;
  const logic = window.WANDENG_LOGIC;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // 界面态（当前屏 / 计时器 / 临时结果）刻意不持久化，每次开屏重来。
  const persistedDefaults = {
    names: ["", ""],
    heat: 1,
    safeWord: "暂停",
    turn: 0,
    used: {},
    boundary: {},
    customPrompts: [],
    board: { pos: [0, 0], theme: "mix", winner: -1 },
    planPile: "room",
  };

  const state = {
    names: ["", ""],
    heat: 1,
    safeWord: "暂停",
    turn: 0,
    used: {},
    boundary: {},
    customPrompts: [],
    screen: "setup",
    afterPass: "tod",
    currentCombo: null,
    currentPenalty: "",
    diceSpin: [0, 0],
    wheelAngle: 0,
    timerId: null,
    timerLeft: 0,
    currentChoice: null,
    currentTimer: null,
    planPile: "room",
    planCard: null,
    board: { pos: [0, 0], theme: "mix", winner: -1 },
    boardRoll: 0,
    boardEvent: null,
  };

  const faces = [
    { rx: 0, ry: 0 },
    { rx: 0, ry: 180 },
    { rx: 0, ry: -90 },
    { rx: 0, ry: 90 },
    { rx: -90, ry: 0 },
    { rx: 90, ry: 0 },
  ];

  function esc(value) {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => map[ch]);
  }

  function load() {
    let raw = null;
    try {
      const text =
        localStorage.getItem(KEY) ||
        LEGACY_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);
      if (text) raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    const migrated = logic.migrateState(raw, persistedDefaults);
    Object.keys(persistedDefaults).forEach((field) => {
      state[field] = migrated.state[field];
    });
  }

  function save() {
    const payload = {};
    Object.keys(persistedDefaults).forEach((field) => {
      payload[field] = state[field];
    });
    try {
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch {
      /* 隐私模式写不进去就放弃这次保存，不影响这一局 */
    }
  }

  function who() {
    return state.names[state.turn] || (state.turn === 0 ? "他" : "她");
  }

  function other() {
    return state.names[1 - state.turn] || (state.turn === 0 ? "她" : "他");
  }

  function genderKey() {
    return state.turn === 0 ? "m" : "f";
  }

  function heat() {
    return data.heats[state.heat];
  }

  /* CJK 词内不断点：复合词插 U+2060（WORD JOINER）。只护真词——护任意断点字对会让
     断点螺旋搬家、词表等价于做分词器。词表取自视觉验收揪出的三句难看断行。 */
  const JOIN_PAIRS = new Set([
    "对方", "可以", "衣服", "不许", "解扣", "二十", "十秒", "三次", "完全", "坐下",
    "坐到", "到底", "才许", "用嘴", "第三", "这一", "一段", "时间", "回床", "镜子",
  ]);

  function joinWords(text) {
    if (!text || text.length < 2) return text;
    let out = text[0];
    for (let i = 1; i < text.length; i++) {
      out += (JOIN_PAIRS.has(text[i - 1] + text[i]) ? "\u2060" : "") + text[i];
    }
    return out;
  }

  function fill(text) {
    if (!text) return "";
    return joinWords(
      String(text)
        .replaceAll("{男}", state.names[0] || "他")
        .replaceAll("{女}", state.names[1] || "她")
        .replaceAll("{who}", who())
        .replaceAll("{other}", other())
    );
  }

  function packOf(kind) {
    return logic.poolFor(kind, state.heat, genderKey(), data, state.customPrompts);
  }

  function dicePack() {
    const raw = data.dice[state.heat];
    if (raw.actions) return raw;
    return raw[genderKey()] || raw.both;
  }

  function show(name) {
    if (name !== "timer") stopTimer();
    state.screen = name;
    document.querySelectorAll(".screen").forEach((el) => {
      el.classList.toggle("active", el.dataset.screen === name);
    });
    syncHeatSteps();
    syncTopbars();
    syncTabbar();
    if (name === "setup") renderHeatButtons();
  }

  function openTab(tab) {
    if (tab === "home") {
      renderHome();
      show("home");
    } else if (tab === "settings") {
      setSettingsStatus("");
      renderBoundary();
      show("settings");
    }
  }

  // save() 刻意留在这里：pick 是唯一改动「不重复」记忆的入口，只有此处落盘才能保证记忆与存档不分叉。
  function pick(list, usedKey) {
    const outcome = logic.pickFrom(list, state.used[usedKey], Math.random);
    state.used[usedKey] = outcome.used;
    save();
    return outcome.item;
  }

  function renderHeatButtons() {
    const grid = $("heatGrid");
    const prevInd = grid.querySelector(".heat-ind");
    grid.innerHTML = data.heats
      .map(
        (h) => `
      <button type="button" class="heat-btn ${h.id === state.heat ? "active" : ""}" data-heat="${h.id}">
        <strong>${h.name}</strong>
        <span>${h.hint}</span>
      </button>`
      )
      .join("");
    if (!grid.querySelector(".heat-ind")) {
      if (prevInd) {
        grid.prepend(prevInd);
      } else {
        const ind = document.createElement("span");
        ind.className = "heat-ind";
        grid.prepend(ind);
      }
    }
    moveHeatInd(grid.querySelector(".heat-btn.active"));
  }

  function moveHeatInd(btn) {
    const ind = $("heatGrid").querySelector(".heat-ind");
    if (!ind || !btn) return;
    ind.style.width = btn.offsetWidth + "px";
    ind.style.transform = "translateX(" + btn.offsetLeft + "px)";
  }

  function positionHeatInd() {
    const grid = $("heatGrid");
    if (!grid) return;
    moveHeatInd(grid.querySelector(".heat-btn.active"));
  }

  function renderHome() {
    if ($("heatPill")) $("heatPill").textContent = `热度  ${heat().name}`;
    $("homeHero").textContent = "今晚只属于你们";
  }

  function renderSafeHints() {
    const text = `安全词：${state.safeWord || "暂停"}`;
    document.querySelectorAll("[data-safe-hint]").forEach((el) => {
      el.textContent = text;
    });
  }

  // 底栏双栏只在首页/设置出现（游戏屏高度预算不够，setup/pass 也隐藏）。
  function syncTabbar() {
    const bar = $("tabbar");
    if (!bar) return;
    const visible = state.screen === "home" || state.screen === "settings";
    bar.classList.toggle("hidden", !visible);
    bar.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tab === state.screen);
    });
  }

  // 三档行为刻意不同：tod 只换胶囊；骰子与轮盘只换题目池并清掉旧结果（结果随机，要等用户自己掷）；
  // 其余屏按新档重抽，让「换一档」当场看得见。
  // 顶栏人名与热度胶囊：切屏、换人、换热度三条路径都走这里，避免三处散写分叉.
  function syncTopbars() {
    $("todWho").textContent = `轮到 ${who()}`;
    $("diceWho").textContent = `轮到 ${who()}`;
    $("wheelWho").textContent = `轮到 ${who()}`;
    $("comboWho").textContent = `轮到 ${who()}`;
    $("sceneWho").textContent = `轮到 ${who()}`;
    $("choiceWho").textContent = `轮到 ${who()}`;
    $("timerWho").textContent = `轮到 ${who()}`;
    $("boardWho").textContent = state.board.winner >= 0 ? "结束" : `轮到 ${who()}`;
    $("todHeat").textContent = heat().name;
    document.querySelectorAll("[data-heat-name]").forEach((el) => {
      el.textContent = heat().name;
    });
  }

  function refreshScreen() {
    renderHome();
    syncHeatSteps();
    syncTopbars();
    const screen = state.screen;
    if (screen === "dice") {
      prepDice();
    } else if (screen === "wheel") {
      renderWheel();
    } else if (screen === "combo") {
      drawCombo();
    } else if (screen === "scene") {
      drawScene();
    } else if (screen === "choice") {
      drawChoice();
    } else if (screen === "timer") {
      drawTimer();
    } else if (screen === "board") {
      renderBoard();
    }
  }

  function shiftHeat(delta) {
    const next = Math.min(2, Math.max(0, state.heat + delta));
    if (next === state.heat) return;
    state.heat = next;
    save();
    refreshScreen();
  }

  function syncHeatSteps() {
    document.querySelectorAll("[data-heat-step]").forEach((btn) => {
      btn.disabled = Number(btn.dataset.heatStep) < 0 ? state.heat === 0 : state.heat === 2;
    });
  }

  const BD_LEVELS = ["no", "maybe", "yes"];
  const BD_LABELS = ["No", "Maybe", "Yes"];

  function bdPlayerRow(side, name, level, itemId) {
    const opts = BD_LABELS.map(
      (label, value) =>
        `<button type="button" class="bd-opt${level === value ? " on-" + BD_LEVELS[value] : ""}"` +
        ` data-bd-id="${itemId}" data-bd-side="${side}" data-bd-value="${value}">${label}</button>`
    ).join("");
    return `<div class="bd-player"><span>${esc(name)}</span><div class="bd-seg">${opts}</div></div>`;
  }

  function renderBoundary() {
    const items = Array.isArray(data.boundary) ? data.boundary : [];
    const status = logic.boundaryStatus(state.boundary, items);

    $("boundaryList").innerHTML = status.items
      .map((row, i) => {
        const item = items[i];
        const tier = (data.heats[item.level - 1] || {}).name || "";
        const cls =
          row.verdict === "both-yes" ? " has-both-yes" : row.verdict === "any-no" ? " has-any-no" : "";
        return (
          `<div class="glass-row${cls}">` +
          `<div class="glass-row-head"><b>${esc(item.zh)}</b><span>${esc(tier)}</span></div>` +
          bdPlayerRow("a", state.names[0] || "他", row.levels[0], item.id) +
          bdPlayerRow("b", state.names[1] || "她", row.levels[1], item.id) +
          `</div>`
        );
      })
      .join("");

    $("boundarySummary").innerHTML =
      `<span class="pill">共同 Yes ${status.counts.bothYes}</span>` +
      `<span class="pill">有 Maybe ${status.counts.hasMaybe}</span>` +
      `<span class="pill">存在 No ${status.counts.anyNo}</span>`;
    $("boundaryPill").textContent = `共同 ${status.counts.bothYes}`;
  }

  function setBoundary(itemId, side, level) {
    const pair = Array.isArray(state.boundary[itemId]) ? state.boundary[itemId].slice() : [null, null];
    const index = side === "a" ? 0 : 1;
    pair[index] = pair[index] === level ? null : level;
    state.boundary[itemId] = pair;
    save();
    renderBoundary();
  }

  /* 自定义题库的导入格式（对外契约，用户要能手写）：
     [{
       kind:   "truth" | "dare" | "wheel" | "penalties"   -> payload 是字符串，也可直接给 text
             | "scenes"  -> {title, setup, do}
             | "choices" -> {q, a, b, doA, doB}
             | "timers"  -> {text, sec}
             | "combo"   -> {q, dare}
       heat:   0 | 1 | 2
       gender: "both" | "m" | "f"
       payload: 该 kind 对应的内容（对象类也可把字段平铺在条目上，省掉 payload 这一层）
     }]
     字段缺失或类型不符的条目会被跳过，不会中断整次导入。 */
  const CUSTOM_SHAPES = {
    truth: (p) => typeof p === "string" && p.trim() !== "",
    dare: (p) => typeof p === "string" && p.trim() !== "",
    wheel: (p) => typeof p === "string" && p.trim() !== "",
    penalties: (p) => typeof p === "string" && p.trim() !== "",
    scenes: (p) => hasStringFields(p, ["title", "setup", "do"]),
    choices: (p) => hasStringFields(p, ["q", "a", "b", "doA", "doB"]),
    combo: (p) => hasStringFields(p, ["q", "dare"]),
    timers: (p) =>
      isPlainish(p) && typeof p.text === "string" && p.text.trim() !== "" && typeof p.sec === "number" && p.sec > 0,
  };

  const CUSTOM_KINDS = Object.keys(CUSTOM_SHAPES);

  function isPlainish(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function hasStringFields(value, fields) {
    if (!isPlainish(value)) return false;
    return fields.every((f) => typeof value[f] === "string" && value[f].trim() !== "");
  }

  function normalizeCustomEntry(entry) {
    if (!isPlainish(entry)) return null;
    const shape = CUSTOM_SHAPES[entry.kind];
    if (!shape) return null;
    if (entry.heat !== 0 && entry.heat !== 1 && entry.heat !== 2) return null;
    if (entry.gender !== "both" && entry.gender !== "m" && entry.gender !== "f") return null;

    let payload = entry.payload;
    if (payload === undefined) {
      if (typeof entry.text === "string") {
        payload = entry.text;
      } else {
        payload = {};
        Object.keys(entry).forEach((key) => {
          if (key !== "kind" && key !== "heat" && key !== "gender") payload[key] = entry[key];
        });
      }
    }
    if (!shape(payload)) return null;
    return { kind: entry.kind, heat: entry.heat, gender: entry.gender, payload: payload };
  }

  function setSettingsStatus(text) {
    const el = $("settingsStatus");
    if (!el) return;
    el.textContent = text || "";
    window.clearTimeout(setSettingsStatus.timer);
    if (text) {
      setSettingsStatus.timer = window.setTimeout(() => {
        el.textContent = "";
      }, 5000);
    }
  }

  function exportBackup() {
    const payload = { app: "wandeng", version: 3, savedAt: new Date().toISOString(), state: {} };
    Object.keys(persistedDefaults).forEach((field) => {
      payload.state[field] = state[field];
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wandeng-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSettingsStatus("已导出备份文件");
  }

  function applyIncoming(incoming) {
    const migrated = logic.migrateState(incoming, persistedDefaults);
    Object.keys(persistedDefaults).forEach((field) => {
      state[field] = migrated.state[field];
    });
    save();
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = logic.sanitizeBackup(String(reader.result));
      if (!parsed.ok) {
        setSettingsStatus("这个文件读不了，什么都没改");
        return;
      }
      applyIncoming(parsed.value.state || parsed.value);
      setSettingsStatus("已导入备份");
      renderSafeHints();
      fillSetup();
      renderHome();
      show("home");
    };
    reader.onerror = () => setSettingsStatus("这个文件读不了，什么都没改");
    reader.readAsText(file);
  }

  function importCustomPrompts(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let raw = null;
      try {
        raw = JSON.parse(String(reader.result));
      } catch {
        raw = null;
      }
      const list = Array.isArray(raw) ? raw : isPlainish(raw) && Array.isArray(raw.prompts) ? raw.prompts : null;
      if (!list) {
        setSettingsStatus("这个文件读不了，什么都没改");
        return;
      }
      const accepted = list.map(normalizeCustomEntry).filter(Boolean);
      if (!accepted.length) {
        setSettingsStatus("没有可用的题目，检查格式");
        return;
      }
      state.customPrompts = state.customPrompts.concat(accepted);
      save();
      setSettingsStatus(`已加入 ${accepted.length} 道自定义题`);
    };
    reader.onerror = () => setSettingsStatus("这个文件读不了，什么都没改");
    reader.readAsText(file);
  }

  const PILE_LABELS = { room: "房间里", out: "出门" };

  function currentPile() {
    return state.planPile === "out" ? "out" : "room";
  }

  function pileCards(pile) {
    const plans = data && data.plans;
    const list = plans && plans[pile];
    return Array.isArray(list) ? list : [];
  }

  function renderPileButtons() {
    document.querySelectorAll("[data-plan-pile]").forEach((btn) => {
      btn.className = btn.dataset.planPile === currentPile() ? "btn btn-honey" : "btn btn-outline";
    });
  }

  function resetPlan() {
    state.planCard = null;
    $("planPill").textContent = PILE_LABELS[currentPile()];
    $("planTitle").textContent = "还没抽";
    $("planMark").textContent = "";
    $("planDesc").textContent = "两堆卡：在房间里做的，和要出门做的。抽到就做，不换。";
    $("planCard").classList.remove("is-foil");
    renderPileButtons();
  }

  function drawPlan() {
    const pile = currentPile();
    const card = pick(pileCards(pile), `plan-${pile}`);
    if (!card) return;
    state.planCard = card;
    $("planPill").textContent = PILE_LABELS[pile];
    $("planTitle").textContent = card.title;
    $("planMark").textContent = card.foil ? "特殊" : PILE_LABELS[pile];
    $("planDesc").textContent = card.desc;
    $("planCard").classList.toggle("is-foil", !!card.foil);
    repopBox($("planTitle"), ".plan-card");
    if (navigator.vibrate) navigator.vibrate(18);
  }

  function setPile(pile) {
    if (pile !== "room" && pile !== "out") return;
    if (pile === currentPile()) return;
    state.planPile = pile;
    save();
    resetPlan();
  }

  const BOARD_COLS = 6;
  const BOARD_TILE_LABEL = {
    start: "起点",
    end: "终点",
    task: "抽题",
    together: "一起",
    cost: "代价",
    skip: "免过",
    forward: "前进",
    back: "后退",
  };

  function boardTiles() {
    const board = data && data.board;
    const tiles = board && board.tiles;
    return Array.isArray(tiles) ? tiles : [];
  }

  function boardThemes() {
    const board = data && data.board;
    const themes = board && board.themes;
    return Array.isArray(themes) && themes.length ? themes : [{ id: "mix", name: "都来" }];
  }

  function currentTheme() {
    return boardThemes().find((t) => t.id === state.board.theme) || boardThemes()[0];
  }

  function boardPoolKind() {
    const id = currentTheme().id;
    if (id === "truth" || id === "dare") return id;
    return state.boardRoll % 2 === 0 ? "truth" : "dare";
  }

  function renderBoard() {
    const tiles = boardTiles();
    let html = "";
    for (let i = 0; i < tiles.length; i++) {
      const pos = logic.serpentine(i, BOARD_COLS);
      const here = state.board.pos[0] === i || state.board.pos[1] === i;
      const toks =
        (state.board.pos[0] === i ? '<i class="tok tok-a"></i>' : "") +
        (state.board.pos[1] === i ? '<i class="tok tok-b"></i>' : "");
      html +=
        `<div class="board-tile kind-${tiles[i].kind}${here ? " here" : ""}"` +
        ` style="grid-row:${pos.row + 1};grid-column:${pos.col + 1}">${i + 1}${toks}</div>`;
    }
    $("boardGrid").innerHTML = html;

    const done = state.board.winner >= 0;
    $("boardWho").textContent = done ? "结束" : `轮到 ${who()}`;
    $("boardPill").textContent = done ? "已分胜负" : `第 ${state.board.pos[state.turn] + 1} 格`;
    $("btnBoardTheme").textContent = `玩法：${currentTheme().name}`;
    $("btnBoardRoll").textContent = done ? "再来一局" : "掷骰子";

    const ev = state.boardEvent;
    $("boardTitle").textContent = ev ? ev.title : "掷骰子";
    $("boardMark").textContent = ev ? ev.mark : currentTheme().name;
    $("boardLine").textContent = ev ? ev.line : `两个人轮流。先走到第 ${tiles.length} 格的人赢。`;
  }

  function resetBoard() {
    state.board = { pos: [0, 0], theme: state.board.theme, winner: -1 };
    state.boardRoll = 0;
    state.boardEvent = null;
    save();
    renderBoard();
  }

  function rollBoard() {
    if (state.board.winner >= 0) return;
    const tiles = boardTiles();
    if (!tiles.length) return;

    const mover = state.turn;
    const from = state.board.pos[mover];
    const roll = 1 + Math.floor(Math.random() * 6);
    const to = logic.stepTile(tiles, from, roll).to;
    const tile = tiles[to] || { kind: "task" };

    state.boardRoll = roll;
    state.board.pos = state.board.pos.slice();
    state.board.pos[mover] = to;

    const head = `掷出 ${roll}：第 ${from + 1} 格走到第 ${to + 1} 格。`;
    let title = `第 ${to + 1} 格 · ${BOARD_TILE_LABEL[tile.kind] || tile.kind}`;
    let line = head;
    let again = false;

    if (tile.kind === "task") {
      const kind = boardPoolKind();
      line = `${head} ${fill(pick(packOf(kind), `${kind}-${genderKey()}`)) || ""}`;
    } else if (tile.kind === "together") {
      const pile = state.boardRoll % 2 === 0 ? "room" : "out";
      const card = pick(pileCards(pile), `plan-${pile}`);
      if (card) line = `${head} 两个人一起：${card.title}——${card.desc}`;
    } else if (tile.kind === "cost") {
      line = `${head} 落到代价：${fill(pick(packOf("penalties"), `penalty-${genderKey()}`)) || ""}`;
    } else if (tile.kind === "skip") {
      again = true;
      line = `${head} 这一格免过，${who()} 再掷一次。`;
    } else if (tile.kind === "end") {
      state.board.winner = mover;
      title = `${who()} 到终点`;
      line = `${head} ${who()} 先走到第 ${tiles.length} 格，赢了。`;
    } else if (tile.kind === "forward" || tile.kind === "back") {
      line = `${head} 棋子被这一格又挪了一段，停在上面那格。`;
    } else {
      line = `${head} 起点，什么也不用做。`;
    }

    state.boardEvent = { title: title, mark: who(), line: line };
    if (!again && tile.kind !== "end") state.turn = 1 - state.turn;
    save();
    renderBoard();
    repopBox($("boardLine"), ".board-slot");
    if (navigator.vibrate) navigator.vibrate(again ? [12, 30, 12] : 18);
  }

  function cycleBoardTheme() {
    const themes = boardThemes();
    const index = themes.findIndex((t) => t.id === state.board.theme);
    state.board.theme = themes[(index + 1 + themes.length) % themes.length].id;
    state.boardEvent = null;
    save();
    renderBoard();
  }

  function boardPrimary() {
    if (state.board.winner >= 0) {
      resetBoard();
      return;
    }
    rollBoard();
  }

  function repop(el) {
    if (!el) return;
    if (el.classList.contains("reveal")) return;
    el.classList.remove("repick", "reveal");
    // 先藏住再强制重排：否则 WebKit 会把「未加动画的新文案 + opacity 1」提交成一帧，闪一下再淡入
    el.style.opacity = "0";
    void el.offsetWidth;
    el.style.opacity = "";
    el.classList.add("repick", "reveal");
    const onEnd = (e) => {
      if (/repick/i.test(e.animationName)) {
        el.addEventListener("animationend", onEnd, { once: true });
        return;
      }
      // 两个类一起摘：只摘 reveal 会让 animation 简写退化成 repick，WebKit 把它当新动画从 0% 重启（多闪一次）
      el.classList.remove("reveal", "repick");
    };
    el.addEventListener("animationend", onEnd, { once: true });
  }

  function repopBox(el, selector) {
    repop(el && el.closest(selector));
  }

  function drawCard(kind) {
    const text = pick(packOf(kind), `${kind}-${genderKey()}`);
    $("todKind").textContent = kind === "truth" ? "真心话" : "大冒险";
    $("todText").textContent = fill(text);
    repopBox($("todText"), ".play-card");
  }

  function buildDie(el, labels, wine) {
    el.innerHTML = labels
      .map(
        (label, i) =>
          `<div class="face ${wine ? "wine" : ""}" data-face="${i + 1}">${label}</div>`
      )
      .join("");
  }

  function setDie(el, index, spins) {
    const f = faces[index];
    const extraX = 360 * (4 + spins);
    const extraY = 360 * (3 + spins);
    el.style.transform = `rotateX(${f.rx + extraX}deg) rotateY(${f.ry + extraY}deg)`;
  }

  function lineFor(action, body) {
    const lines = data.diceLines[state.heat] || data.diceLines[0];
    const tpl = lines[Math.floor(Math.random() * lines.length)];
    const verb = data.diceVerb[action] || action;
    return joinWords(
      fill(tpl)
        .replaceAll("{action}", action)
        .replaceAll("{body}", body)
        .replaceAll("{verb}", verb)
    );
  }

  function prepDice() {
    const pack = dicePack();
    buildDie($("dieAction"), pack.actions, false);
    buildDie($("dieBody"), pack.bodies, true);
    $("diceTitle").textContent = state.heat === 2 ? "深夜 · 动作 × 部位" : "动作 × 部位";
    $("diceLine").textContent =
      state.heat === 2
        ? "这一档不再是亲亲锁骨。掷出来，就按最直接的那句做。"
        : "点下面，掷出这一轮。";
  }

  let diceBusy = false;

  function rollDice() {
    if (diceBusy) return;
    const pack = dicePack();
    const a = Math.floor(Math.random() * pack.actions.length);
    const action = pack.actions[a];
    const allow = data.diceAllow?.[state.heat]?.[genderKey()]?.[action];
    const bodyPool = allow && allow.length ? allow : pack.bodies;
    const body = bodyPool[Math.floor(Math.random() * bodyPool.length)];
    let b = pack.bodies.indexOf(body);
    if (b < 0) b = Math.floor(Math.random() * pack.bodies.length);
    state.diceSpin[0] += 1;
    state.diceSpin[1] += 1;
    if (!reduceMotion.matches) {
      diceBusy = true;
      $("dieAction").classList.add("anticipate");
      $("dieBody").classList.add("anticipate");
      $("btnRoll").classList.add("windup");
      window.setTimeout(() => {
        diceBusy = false;
        $("dieAction").classList.remove("anticipate");
        $("dieBody").classList.remove("anticipate");
        $("btnRoll").classList.remove("windup");
      }, 240);
    }
    $("dieAction").classList.add("rolling");
    $("dieBody").classList.add("rolling");
    setDie($("dieAction"), a, state.diceSpin[0]);
    setDie($("dieBody"), b, state.diceSpin[1]);
    $("diceTitle").textContent = `${action} × ${body}`;
    $("diceLine").textContent = lineFor(action, body);
    repopBox($("diceLine"), ".result");
    if (navigator.vibrate) navigator.vibrate([12, 40, 18]);
  }

  function renderWheel() {
    $("wheel").innerHTML = Array.from({ length: 8 })
      .map((_, i) => {
        const rot = i * 45 + 22.5;
        return `<span style="transform: rotate(${rot}deg) translate(72px, -6px)">·</span>`;
      })
      .join("");
    $("wheelTitle").textContent = "转起来";
    $("wheelLine").textContent = "指针停下后，按出现的那一句做。";
  }

  let wheelBusy = false;

  function spinWheel() {
    if (wheelBusy) return;
    const text = pick(packOf("wheel"), `wheel-${genderKey()}`);
    state.wheelAngle += 360 * 6 + Math.floor(Math.random() * 360);
    if (!reduceMotion.matches) {
      wheelBusy = true;
      $("wheel").classList.add("anticipate");
      $("btnSpin").classList.add("windup");
      window.setTimeout(() => {
        wheelBusy = false;
        $("wheel").classList.remove("anticipate");
        $("btnSpin").classList.remove("windup");
      }, 240);
    }
    $("wheel").style.transform = `rotate(${state.wheelAngle}deg)`;
    window.setTimeout(() => {
      $("wheelTitle").textContent = fill(text);
      $("wheelLine").textContent = `${who()} 来做。${other()} 看着，也可以帮忙。`;
      repopBox($("wheelLine"), ".result");
    }, 3200);
    if (navigator.vibrate) navigator.vibrate(18);
  }

  function resetCombo() {
    state.currentCombo = null;
    $("comboKicker").textContent = "先答";
    $("comboQ").textContent = "点下面，抽出一道。先认真答。";
    $("comboDare").textContent = "";
    $("comboHint").textContent = "答完点下面，答案会变成要做的事。";
    $("btnComboDraw").classList.remove("hidden");
    $("btnComboDraw").textContent = "抽一题";
    $("btnComboGo").classList.add("hidden");
  }

  function drawCombo() {
    const card = pick(packOf("combo"), `combo-${genderKey()}`);
    state.currentCombo = card;
    $("comboKicker").textContent = "先认真答";
    $("comboQ").textContent = fill(card.q);
    $("comboDare").textContent = "";
    $("comboHint").textContent = "说完再点下面。规则允许你现在按答案做。";
    $("btnComboDraw").classList.add("hidden");
    $("btnComboGo").classList.remove("hidden");
    repopBox($("comboQ"), ".play-card");
  }

  function revealCombo() {
    const card = state.currentCombo;
    if (!card) return;
    $("comboKicker").textContent = "现在做";
    $("comboDare").textContent = fill(card.dare);
    $("comboHint").textContent = "现在按这个做。";
    $("btnComboGo").classList.add("hidden");
    $("btnComboDraw").classList.remove("hidden");
    $("btnComboDraw").textContent = "再抽一题";
    repopBox($("comboQ"), ".play-card");
  }

  function resetScene() {
    $("sceneKicker").textContent = "抽一幕";
    $("sceneTitle").textContent = "点下面，抽出今晚要演的一幕。";
    $("sceneSetup").textContent = "";
    $("sceneDo").textContent = "";
  }

  function drawScene() {
    const card = pick(packOf("scenes"), `scene-${genderKey()}`);
    $("sceneKicker").textContent = "这一幕";
    $("sceneTitle").textContent = fill(card.title);
    $("sceneSetup").textContent = fill(card.setup);
    $("sceneDo").textContent = fill(card.do);
    repopBox($("sceneTitle"), ".play-card");
  }

  function resetChoice() {
    clearChoiceState();
    state.currentChoice = null;
    $("choiceQ").textContent = "点下面，抽出一道必须选的题。";
    $("choiceDo").textContent = "";
    $("choiceBtns").classList.add("hidden");
    $("btnChoiceDraw").classList.remove("hidden");
  }

  function drawChoice() {
    clearChoiceState();
    const card = pick(packOf("choices"), `choice-${genderKey()}`);
    state.currentChoice = card;
    $("choiceQ").textContent = fill(card.q);
    $("choiceDo").textContent = "选一个。选完就按那个做。";
    $("choiceA").textContent = fill(card.a);
    $("choiceB").textContent = fill(card.b);
    $("choiceBtns").classList.remove("hidden");
    $("btnChoiceDraw").classList.add("hidden");
    repopBox($("choiceQ"), ".play-card");
  }

  function clearChoiceState() {
    window.clearTimeout(pickChoice.timer);
    pickChoice.timer = 0;
    $("choiceA").classList.remove("is-selected", "is-dimmed");
    $("choiceB").classList.remove("is-selected", "is-dimmed");
  }

  function markChoice(side) {
    if (pickChoice.timer) return;
    const picked = side === "a" ? $("choiceA") : $("choiceB");
    const sibling = side === "a" ? $("choiceB") : $("choiceA");
    picked.classList.remove("is-dimmed");
    picked.classList.add("is-selected");
    sibling.classList.remove("is-selected");
    sibling.classList.add("is-dimmed");
  }

  function pickChoice(side) {
    const card = state.currentChoice;
    if (!card || pickChoice.timer) return;
    // 300ms = .is-selected 的 280ms 过渡 + 余量；display:none 会在同一帧取消过渡，故必须延后收起/揭晓
    pickChoice.timer = window.setTimeout(() => {
      pickChoice.timer = 0;
      $("choiceDo").textContent = fill(side === "a" ? card.doA : card.doB);
      $("choiceBtns").classList.add("hidden");
      $("btnChoiceDraw").classList.remove("hidden");
      $("btnChoiceDraw").textContent = "再抽一道";
      repopBox($("choiceDo"), ".play-card");
    }, 300);
  }

  function formatTime(sec) {
    const n = Math.max(0, sec);
    return n < 10 ? `0${n}` : String(n);
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function resetTimerView() {
    stopTimer();
    state.currentTimer = null;
    $("timerKicker").textContent = "铃响之前";
    $("timerNum").textContent = "00";
    $("timerNum").classList.remove("done");
    $("timerText").textContent = "点下面，抽出限时要做的事。";
    $("btnTimerStart").textContent = "开始";
    $("btnTimerStart").disabled = true;
  }

  function drawTimer() {
    stopTimer();
    const card = pick(packOf("timers"), `timer-${genderKey()}`);
    state.currentTimer = card;
    state.timerLeft = card.sec;
    $("timerKicker").innerHTML = `<span class="tight">${card.sec}</span> 秒`;
    $("timerNum").textContent = formatTime(card.sec);
    $("timerNum").classList.remove("done");
    $("timerText").textContent = fill(card.text);
    $("btnTimerStart").textContent = "开始";
    $("btnTimerStart").disabled = false;
    repopBox($("timerText"), ".play-card");
  }

  function startTimer() {
    if (!state.currentTimer || state.timerId) return;
    state.timerLeft = state.currentTimer.sec;
    $("btnTimerStart").textContent = "进行中";
    $("btnTimerStart").disabled = true;
    $("timerNum").classList.remove("done");
    if (navigator.vibrate) navigator.vibrate(12);
    state.timerId = window.setInterval(() => {
      state.timerLeft -= 1;
      $("timerNum").textContent = formatTime(state.timerLeft);
      if (state.timerLeft <= 0) {
        stopTimer();
        $("timerNum").textContent = "00";
        $("timerNum").classList.add("done");
        $("timerNum").classList.add("pulse");
        window.setTimeout(() => $("timerNum").classList.remove("pulse"), 600);
        $("timerKicker").textContent = "时间到";
        $("btnTimerStart").textContent = "再来一次";
        $("btnTimerStart").disabled = false;
        if (navigator.vibrate) navigator.vibrate([40, 40, 80]);
      }
    }, 1000);
  }

  let safeTrigger = null;

  function focusableSheetButtons() {
    return [...$("safeModal").querySelectorAll("button")].filter(
      (b) => !b.classList.contains("hidden") && !b.disabled && b.offsetParent !== null
    );
  }

  function openSafeModal() {
    safeTrigger = document.activeElement;
    $("safeModal").classList.add("active");
    $("safeClose").focus();
  }

  function closeSafeModal() {
    const wasOpen = $("safeModal").classList.contains("active");
    const trigger = safeTrigger;
    safeTrigger = null;
    $("safeModal").classList.remove("active");
    if (wasOpen && trigger && document.contains(trigger)) {
      window.setTimeout(() => {
        if (document.contains(trigger)) trigger.focus();
      }, 320);
    }
  }

  function openCost() {
    stopTimer();
    const item = pick(packOf("penalties"), `penalty-${genderKey()}`);
    state.currentPenalty = fill(item);
    $("safeTitle").textContent = state.safeWord || "过";
    $("safeLead").textContent = `${who()}过了这题。代价：`;
    $("safeCost").textContent = state.currentPenalty;
    openSafeModal();
  }

  function applyPenalty(text) {
    const screen = state.screen;
    if (screen === "tod") {
      $("todKind").textContent = "代价";
      $("todText").textContent = text;
    } else if (screen === "dice") {
      $("diceTitle").textContent = "过了 · 代价";
      $("diceLine").textContent = text;
    } else if (screen === "wheel") {
      $("wheelTitle").textContent = "过了 · 代价";
      $("wheelLine").textContent = text;
    } else if (screen === "combo") {
      $("comboKicker").textContent = "代价";
      $("comboQ").textContent = text;
      $("comboDare").textContent = "";
      $("comboHint").textContent = "";
      $("btnComboGo").classList.add("hidden");
      $("btnComboDraw").classList.remove("hidden");
      $("btnComboDraw").textContent = "再抽一题";
      state.currentCombo = null;
    } else if (screen === "scene") {
      $("sceneKicker").textContent = "代价";
      $("sceneTitle").textContent = "这幕不做";
      $("sceneSetup").textContent = "";
      $("sceneDo").textContent = text;
    } else if (screen === "choice") {
      $("choiceQ").textContent = "这题不做";
      $("choiceDo").textContent = text;
      $("choiceBtns").classList.add("hidden");
      $("btnChoiceDraw").classList.remove("hidden");
      $("btnChoiceDraw").textContent = "再抽一道";
    } else if (screen === "timer") {
      stopTimer();
      $("timerKicker").textContent = "代价";
      $("timerText").textContent = text;
      $("btnTimerStart").disabled = true;
    }
  }

  function passTo(nextScreen) {
    stopTimer();
    state.afterPass = nextScreen;
    state.turn = 1 - state.turn;
    $("passName").textContent = who();
    $("passConfirm").textContent = `我是${who()}`;
    show("pass");
  }

  function openGame(game) {
    if (game === "tod") {
      show("tod");
    } else if (game === "dice") {
      prepDice();
      show("dice");
    } else if (game === "wheel") {
      renderWheel();
      show("wheel");
    } else if (game === "combo") {
      resetCombo();
      show("combo");
    } else if (game === "scene") {
      resetScene();
      show("scene");
    } else if (game === "choice") {
      $("btnChoiceDraw").textContent = "抽一道";
      resetChoice();
      show("choice");
    } else if (game === "timer") {
      resetTimerView();
      drawTimer();
      show("timer");
    } else if (game === "settings") {
      setSettingsStatus("");
      renderBoundary();
      show("settings");
    } else if (game === "board") {
      state.boardEvent = null;
      renderBoard();
      show("board");
    }
  }

  function fillSetup() {
    $("nameA").value = state.names[0];
    $("nameB").value = state.names[1];
    $("safeWord").value = state.safeWord || "暂停";
    renderHeatButtons();
  }

  const RIPPLE_TARGETS = ".btn, .row-card, .more-grid button, .icon-btn, .bd-opt";

  function ripple(e) {
    if (reduceMotion.matches) return;
    const target = e.target && e.target.closest ? e.target.closest(RIPPLE_TARGETS) : null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const size = 2 * Math.max(target.offsetWidth, target.offsetHeight);
    const span = document.createElement("span");
    span.className = "ripple";
    span.style.width = size + "px";
    span.style.height = size + "px";
    span.style.left = `${e.clientX - rect.left - size / 2}px`;
    span.style.top = `${e.clientY - rect.top - size / 2}px`;
    target.appendChild(span);
    span.addEventListener("animationend", () => span.remove(), { once: true });
  }

  function revealImages() {
    document.querySelectorAll("img.img-reveal").forEach((img) => {
      const done = () => img.classList.add("is-loaded");
      const ready = () => {
        if (img.decode) img.decode().then(done).catch(() => {});
        else done();
      };
      if (img.complete) {
        ready();
      } else {
        img.addEventListener("load", ready, { once: true });
        img.addEventListener("error", done, { once: true });
      }
    });
  }

  // 导入的备份可能带着越界或非整数的棋子位置：留着会渲染不出棋子，掷一次还会直接判胜。
  function clampBoardToTiles() {
    const last = boardTiles().length - 1;
    if (last < 0) return;
    let dirty = false;
    const pos = state.board.pos.map((p) => {
      if (!Number.isInteger(p) || p < 0 || p > last) {
        dirty = true;
        return 0;
      }
      return p;
    });
    if (dirty) {
      state.board = { pos: pos, theme: state.board.theme, winner: -1 };
      save();
    }
  }

  function boot() {
    load();
    clampBoardToTiles();
    fillSetup();
    renderSafeHints();
    revealImages();
    if (state.names[0] && state.names[1]) {
      renderHome();
      show("home");
    }

    $("heatGrid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-heat]");
      if (!btn) return;
      state.heat = Number(btn.dataset.heat);
      save();
      renderHeatButtons();
    });

    let heatResizeId = null;
    window.addEventListener("resize", () => {
      clearTimeout(heatResizeId);
      heatResizeId = setTimeout(positionHeatInd, 150);
    });

    document.addEventListener("pointerdown", ripple);

    $("startBtn").addEventListener("click", () => {
      state.names = [$("nameA").value.trim() || "他", $("nameB").value.trim() || "她"];
      state.safeWord = $("safeWord").value.trim() || "暂停";
      state.turn = 0;
      save();
      renderSafeHints();
      renderHome();
      show("home");
    });

    window.wandengOpen = openGame;
    document.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openGame(btn.dataset.open));
    });
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => openTab(btn.dataset.tab));
    });

    $("resetBtn").addEventListener("click", () => {
      show("setup");
    });

    $("boundaryList").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-bd-value]");
      if (!btn) return;
      setBoundary(btn.dataset.bdId, btn.dataset.bdSide, Number(btn.dataset.bdValue));
    });

    $("boundaryClear").addEventListener("click", () => {
      state.boundary = {};
      save();
      renderBoundary();
    });

    $("btnExport").addEventListener("click", exportBackup);

    document.querySelectorAll("[data-plan-pile]").forEach((btn) => {
      btn.addEventListener("click", () => setPile(btn.dataset.planPile));
    });
    $("btnPlanDraw").addEventListener("click", drawPlan);
    $("btnBoardRoll").addEventListener("click", boardPrimary);
    $("btnBoardTheme").addEventListener("click", cycleBoardTheme);

    $("importBackup").addEventListener("change", (e) => {
      const file = e.currentTarget.files && e.currentTarget.files[0];
      if (file) importBackup(file);
      e.currentTarget.value = "";
    });

    $("importCustom").addEventListener("change", (e) => {
      const file = e.currentTarget.files && e.currentTarget.files[0];
      if (file) importCustomPrompts(file);
      e.currentTarget.value = "";
    });

    document.querySelectorAll("[data-heat-step]").forEach((btn) => {
      btn.addEventListener("click", () => shiftHeat(Number(btn.dataset.heatStep)));
    });

    document.querySelectorAll("[data-back]").forEach((btn) => {
      btn.addEventListener("click", () => {
        stopTimer();
        renderHome();
        show("home");
      });
    });

    $("btnTruth").addEventListener("click", () => drawCard("truth"));
    $("btnDare").addEventListener("click", () => drawCard("dare"));
    $("btnNext").addEventListener("click", () => passTo("tod"));

    $("btnRoll").addEventListener("click", rollDice);
    $("btnDiceNext").addEventListener("click", () => passTo("dice"));

    $("btnSpin").addEventListener("click", spinWheel);
    $("btnWheelNext").addEventListener("click", () => passTo("wheel"));

    $("btnComboDraw").addEventListener("click", drawCombo);
    $("btnComboGo").addEventListener("click", revealCombo);
    $("btnComboNext").addEventListener("click", () => passTo("combo"));

    $("btnScene").addEventListener("click", drawScene);
    $("btnSceneNext").addEventListener("click", () => passTo("scene"));

    $("btnChoiceDraw").addEventListener("click", drawChoice);
    $("choiceA").addEventListener("click", () => {
      markChoice("a");
      pickChoice("a");
    });
    $("choiceB").addEventListener("click", () => {
      markChoice("b");
      pickChoice("b");
    });
    $("btnChoiceNext").addEventListener("click", () => {
      clearChoiceState();
      passTo("choice");
    });

    $("btnTimerStart").addEventListener("click", () => {
      if ($("btnTimerStart").textContent === "再来一次" && state.currentTimer) {
        startTimer();
        return;
      }
      startTimer();
    });
    $("btnTimerDraw").addEventListener("click", drawTimer);
    $("btnTimerNext").addEventListener("click", () => passTo("timer"));

    $("passConfirm").addEventListener("click", () => {
      const next = state.afterPass;
      syncTopbars();
      if (next === "tod") {
        $("todKind").textContent = "轮到你了";
        $("todText").textContent = "选真心话，还是大冒险。";
      } else if (next === "dice") {
        prepDice();
      } else if (next === "wheel") {
        renderWheel();
      } else if (next === "combo") {
        resetCombo();
      } else if (next === "scene") {
        resetScene();
      } else if (next === "choice") {
        $("btnChoiceDraw").textContent = "抽一道";
        resetChoice();
      } else if (next === "timer") {
        resetTimerView();
        drawTimer();
      }
      show(next);
    });

    document.querySelectorAll(".js-pass").forEach((btn) => {
      btn.addEventListener("click", openCost);
    });
    $("safeAccept").addEventListener("click", () => {
      const penalty = state.currentPenalty;
      closeSafeModal();
      if (penalty) applyPenalty(penalty);
    });
    $("safeClose").addEventListener("click", closeSafeModal);
    $("coolDown").addEventListener("click", () => {
      closeSafeModal();
      state.heat = Math.max(0, state.heat - 1);
      save();
      refreshScreen();
    });

    $("safeModal").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeSafeModal();
    });

    $("safeModal").addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSafeModal();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusableSheetButtons();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("./sw.js?v=14", { updateViaCache: "none" })
        .catch(() => {});
    }
  }

  boot();
})();
