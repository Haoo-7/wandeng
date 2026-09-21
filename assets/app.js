(() => {
  const KEY = "wandeng-state-v2";
  const data = window.WANDENG;
  const $ = (id) => document.getElementById(id);

  const state = {
    names: ["", ""],
    heat: 1,
    safeWord: "暂停",
    turn: 0,
    screen: "setup",
    afterPass: "tod",
    used: { truth: [], dare: [], scene: [], choice: [], timer: [], wheel: [], combo: [], penalty: [] },
    currentCombo: null,
    currentPenalty: "",
    diceSpin: [0, 0],
    wheelAngle: 0,
    timerId: null,
    timerLeft: 0,
    currentChoice: null,
    currentTimer: null,
  };

  const faces = [
    { rx: 0, ry: 0 },
    { rx: 0, ry: 180 },
    { rx: 0, ry: -90 },
    { rx: 0, ry: 90 },
    { rx: -90, ry: 0 },
    { rx: 90, ry: 0 },
  ];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      state.names = saved.names || state.names;
      state.heat = saved.heat ?? state.heat;
      state.safeWord = saved.safeWord || state.safeWord;
      state.turn = saved.turn || 0;
    } catch {
      /* keep defaults */
    }
  }

  function save() {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        names: state.names,
        heat: state.heat,
        safeWord: state.safeWord,
        turn: state.turn,
      })
    );
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

  function fill(text) {
    if (!text) return "";
    return String(text)
      .replaceAll("{男}", state.names[0] || "他")
      .replaceAll("{女}", state.names[1] || "她")
      .replaceAll("{who}", who())
      .replaceAll("{other}", other());
  }

  function packOf(kind) {
    const pack = data && data[kind];
    const raw = pack && pack[state.heat];
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return [...(raw.both || []), ...(raw[genderKey()] || [])];
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
  }

  function pick(list, usedKey) {
    const used = state.used[usedKey] || [];
    const pool = list.filter((item) => !used.includes(item));
    const source = pool.length ? pool : list;
    if (!pool.length) state.used[usedKey] = [];
    const item = source[Math.floor(Math.random() * source.length)];
    state.used[usedKey] = (state.used[usedKey] || []).concat(item);
    return item;
  }

  function renderHeatButtons() {
    $("heatGrid").innerHTML = data.heats
      .map(
        (h) => `
      <button type="button" class="heat-btn ${h.id === state.heat ? "active" : ""}" data-heat="${h.id}">
        <strong>${h.name}</strong>
        <span>${h.hint}</span>
      </button>`
      )
      .join("");
  }

  function renderHome() {
    $("heatPill").textContent = `热度  ${heat().name}`;
    $("homeHero").textContent = "今晚只属于你们";
  }

  function drawCard(kind) {
    const text = pick(packOf(kind), `${kind}-${genderKey()}`);
    $("todKind").textContent = kind === "truth" ? "真心话" : "大冒险";
    $("todText").textContent = fill(text);
    $("todWho").textContent = `${who()} 的回合`;
    $("todHeat").textContent = heat().name;
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
    return fill(tpl)
      .replaceAll("{action}", action)
      .replaceAll("{body}", body)
      .replaceAll("{verb}", verb);
  }

  function prepDice() {
    const pack = dicePack();
    buildDie($("dieAction"), pack.actions, false);
    buildDie($("dieBody"), pack.bodies, true);
    $("diceWho").textContent = `${who()} 来做`;
    $("diceTitle").textContent = state.heat === 2 ? "深夜 · 动作 × 部位" : "动作 × 部位";
    $("diceLine").textContent =
      state.heat === 2
        ? "这一档不再是亲亲锁骨。掷出来，就按最直接的那句做。"
        : "点下面，掷出这一轮要做的事。";
  }

  function rollDice() {
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
    $("dieAction").classList.add("rolling");
    $("dieBody").classList.add("rolling");
    setDie($("dieAction"), a, state.diceSpin[0]);
    setDie($("dieBody"), b, state.diceSpin[1]);
    $("diceTitle").textContent = `${action} × ${body}`;
    $("diceLine").textContent = lineFor(action, body);
    if (navigator.vibrate) navigator.vibrate([12, 40, 18]);
  }

  function renderWheel() {
    $("wheel").innerHTML = Array.from({ length: 8 })
      .map((_, i) => {
        const rot = i * 45 + 22.5;
        return `<span style="transform: rotate(${rot}deg) translate(72px, -6px)">·</span>`;
      })
      .join("");
    $("wheelWho").textContent = who();
    $("wheelTitle").textContent = "转起来";
    $("wheelLine").textContent = "指针停下后，按出现的那一句做。";
  }

  function spinWheel() {
    const text = pick(packOf("wheel"), `wheel-${genderKey()}`);
    state.wheelAngle += 360 * 6 + Math.floor(Math.random() * 360);
    $("wheel").style.transform = `rotate(${state.wheelAngle}deg)`;
    window.setTimeout(() => {
      $("wheelTitle").textContent = fill(text);
      $("wheelLine").textContent = `${who()} 来做。${other()} 看着，也可以帮忙。`;
    }, 3200);
    if (navigator.vibrate) navigator.vibrate(18);
  }

  function resetCombo() {
    state.currentCombo = null;
    $("comboWho").textContent = who();
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
    $("comboWho").textContent = who();
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
  }

  function resetScene() {
    $("sceneWho").textContent = who();
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
    $("sceneWho").textContent = who();
  }

  function resetChoice() {
    state.currentChoice = null;
    $("choiceWho").textContent = who();
    $("choiceQ").textContent = "点下面，抽出一道必须选的题。";
    $("choiceDo").textContent = "";
    $("choiceBtns").classList.add("hidden");
    $("btnChoiceDraw").classList.remove("hidden");
  }

  function drawChoice() {
    const card = pick(packOf("choices"), `choice-${genderKey()}`);
    state.currentChoice = card;
    $("choiceQ").textContent = fill(card.q);
    $("choiceDo").textContent = "选一个。选完就按那个做。";
    $("choiceA").textContent = fill(card.a);
    $("choiceB").textContent = fill(card.b);
    $("choiceBtns").classList.remove("hidden");
    $("btnChoiceDraw").classList.add("hidden");
    $("choiceWho").textContent = who();
  }

  function pickChoice(side) {
    const card = state.currentChoice;
    if (!card) return;
    $("choiceDo").textContent = fill(side === "a" ? card.doA : card.doB);
    $("choiceBtns").classList.add("hidden");
    $("btnChoiceDraw").classList.remove("hidden");
    $("btnChoiceDraw").textContent = "再抽一道";
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
    $("timerWho").textContent = who();
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
    $("timerKicker").textContent = `${card.sec} 秒`;
    $("timerNum").textContent = formatTime(card.sec);
    $("timerNum").classList.remove("done");
    $("timerText").textContent = fill(card.text);
    $("btnTimerStart").textContent = "开始";
    $("btnTimerStart").disabled = false;
    $("timerWho").textContent = who();
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
        $("timerKicker").textContent = "时间到";
        $("btnTimerStart").textContent = "再来一次";
        $("btnTimerStart").disabled = false;
        if (navigator.vibrate) navigator.vibrate([40, 40, 80]);
      }
    }, 1000);
  }

  function openCost() {
    stopTimer();
    const item = pick(packOf("penalties"), `penalty-${genderKey()}`);
    state.currentPenalty = fill(item);
    $("safeTitle").textContent = state.safeWord || "过";
    $("safeLead").textContent = `${who()}过了这题。代价：`;
    $("safeCost").textContent = state.currentPenalty;
    $("safeModal").classList.add("active");
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
      $("todWho").textContent = `${who()} 的回合`;
      $("todHeat").textContent = heat().name;
      $("todKind").textContent = "今晚";
      $("todText").textContent = "先选真心话，还是大冒险。";
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
    }
  }

  function fillSetup() {
    $("nameA").value = state.names[0];
    $("nameB").value = state.names[1];
    $("safeWord").value = state.safeWord || "暂停";
    renderHeatButtons();
  }

  function boot() {
    load();
    fillSetup();
    if (state.names[0] && state.names[1]) {
      renderHome();
      show("home");
    }

    $("heatGrid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-heat]");
      if (!btn) return;
      state.heat = Number(btn.dataset.heat);
      renderHeatButtons();
    });

    $("startBtn").addEventListener("click", () => {
      state.names = [$("nameA").value.trim() || "他", $("nameB").value.trim() || "她"];
      state.safeWord = $("safeWord").value.trim() || "暂停";
      state.turn = 0;
      save();
      renderHome();
      show("home");
    });

    window.wandengOpen = openGame;
    document.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openGame(btn.dataset.open));
    });

    $("resetBtn").addEventListener("click", () => {
      show("setup");
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
    $("choiceA").addEventListener("click", () => pickChoice("a"));
    $("choiceB").addEventListener("click", () => pickChoice("b"));
    $("btnChoiceNext").addEventListener("click", () => passTo("choice"));

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
      if (next === "tod") {
        $("todWho").textContent = `${who()} 的回合`;
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
      $("safeModal").classList.remove("active");
      if (state.currentPenalty) applyPenalty(state.currentPenalty);
    });
    $("safeClose").addEventListener("click", () => $("safeModal").classList.remove("active"));
    $("coolDown").addEventListener("click", () => {
      state.heat = Math.max(0, state.heat - 1);
      save();
      $("safeModal").classList.remove("active");
      renderHome();
      if (state.screen === "dice") prepDice();
      if (state.screen === "wheel") renderWheel();
      if (state.screen === "tod") $("todHeat").textContent = heat().name;
      if (state.screen === "combo") resetCombo();
      if (state.screen === "scene") resetScene();
      if (state.screen === "choice") {
        $("btnChoiceDraw").textContent = "抽一道";
        resetChoice();
      }
      if (state.screen === "timer") {
        resetTimerView();
        drawTimer();
      }
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("./sw.js?v=7", { updateViaCache: "none" })
        .catch(() => {});
    }
  }

  boot();
})();
