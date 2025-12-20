// Minimal, fast, readable
const $ = (id) => document.getElementById(id);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const shuffleInPlace = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const uniqBy = (arr, keyFn) => {
  const seen = new Set();
  return arr.filter((x) => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const escapeHTML = (s) =>
  (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const normEn = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ");

// -------------------------
// API (礫隊 best only)
// -------------------------
async function apiGetHighScore() {
  const res = await fetch(`/api/highscore`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to get highscore");
  return await res.json(); // {team,best}
}
async function apiPostHighScore(score) {
  const res = await fetch(`/api/highscore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score }),
  });
  if (!res.ok) throw new Error("failed to post highscore");
  return await res.json(); // {team,best,updated}
}

// -------------------------
// State
// -------------------------
const state = {
  entries: [], // {no,en,jp}
  pool: [],
  best: 0,

  // pdf/test
  pdfQuiz: [], // [{q, mode, opts?}]
  pdfDir: "jp2en",

  // practice
  practiceOn: false,
  practiceDir: "jp2en",
  practiceQuiz: [],
  pracIdx: 0,
  pracMist: 0,

  // cards
  cardOn: false,
  cardDeck: [],
  cardIdx: 0,
  cardFace: "en", // en/jp

  // game
  gameOn: false,
  gameDir: "jp2en",
  gameQuiz: [],
  gameIdx: 0,
  timeLeft: 120.0,
  score: 0,
  ok: 0,
  ng: 0,
  streak: 0,
  wrongStreak: 0,
  tick: null,
};

// -------------------------
// Load words (embedded; no upload)
// -------------------------
function loadWords() {
  const arr = Array.isArray(window.WORDS) ? window.WORDS : [];
  arr.sort((a, b) => a.no - b.no);
  state.entries = arr;

  $("startNo").value = 1;
  $("endNo").value = arr.length ? arr[arr.length - 1].no : 1900;

  updatePoolStats();
}

// -------------------------
// Pool / Quiz
// -------------------------
function updatePoolStats() {
  const startNo = Number($("startNo").value || 1);
  const endNo = Number($("endNo").value || 1900);
  const a = Math.min(startNo, endNo);
  const b = Math.max(startNo, endNo);

  state.pool = state.entries.filter((x) => x.no >= a && x.no <= b);

  let n = Number($("count").value || 1);
  const dup = $("dup").value === "1";
  if (!dup) n = Math.min(n, state.pool.length);
  n = Math.max(0, n);

  $("statPool").textContent = state.pool.length;
  $("statN").textContent = n;
}

["startNo", "endNo", "count", "dup", "shuffle"].forEach((id) => {
  $(id).addEventListener("input", updatePoolStats);
  $(id).addEventListener("change", updatePoolStats);
});

function buildQuiz(dir) {
  updatePoolStats();
  const dup = $("dup").value === "1";
  const doShuffle = $("shuffle").value === "1";
  let n = Number($("count").value || 1);

  if (!state.pool.length) return [];

  let picks = [];
  if (!dup) {
    const arr = [...state.pool];
    if (doShuffle) shuffleInPlace(arr);
    n = Math.min(n, arr.length);
    picks = arr.slice(0, n);
  } else {
    for (let i = 0; i < n; i++) {
      picks.push(state.pool[Math.floor(Math.random() * state.pool.length)]);
    }
    if (doShuffle) shuffleInPlace(picks);
  }

  // assign mode per question
  return picks.map((q) => {
    let mode = dir;
    if (dir === "random") mode = Math.random() < 0.5 ? "jp2en" : "en2jp";
    return { q, mode };
  });
}

function buildChoicesJP(correctEntry, k = 8) {
  const base = uniqBy(state.pool.length ? state.pool : state.entries, (x) => x.jp).filter(
    (x) => x.jp !== correctEntry.jp
  );
  shuffleInPlace(base);
  const others = base.slice(0, Math.max(0, k - 1)).map((x) => x.jp);
  const opts = shuffleInPlace([correctEntry.jp, ...others]);
  // ensure unique
  return uniqBy(opts, (x) => x).slice(0, k);
}

// -------------------------
// Tabs / Panels
// -------------------------
function setMode(mode) {
  $("tabPdf").classList.toggle("active", mode === "pdf");
  $("tabPractice").classList.toggle("active", mode === "practice");
  $("tabGame").classList.toggle("active", mode === "game");

  $("pdfSettings").classList.toggle("hidden", mode !== "pdf");
  $("practiceSettings").classList.toggle("hidden", mode !== "practice");
  $("gameSettings").classList.toggle("hidden", mode !== "game");

  $("panelPdf").classList.toggle("hidden", mode !== "pdf");
  $("panelPractice").classList.toggle("hidden", mode !== "practice");
  $("panelGame").classList.toggle("hidden", mode !== "game");

  // close cards panel when switching main mode
  $("panelCards").classList.add("hidden");
  state.cardOn = false;

  if (mode === "pdf") renderPdfIdle();
  if (mode === "practice") renderPracticeIdle();
  if (mode === "game") renderGameIdle();
}

$("tabPdf").addEventListener("click", () => setMode("pdf"));
$("tabPractice").addEventListener("click", () => setMode("practice"));
$("tabGame").addEventListener("click", () => setMode("game"));

// -------------------------
// Highscore HUD
// -------------------------
function setBest(best) {
  state.best = Number(best || 0);
  $("bestScore").textContent = state.best;
  $("hudBest").textContent = state.best;
}

async function initHighScore() {
  try {
    const hs = await apiGetHighScore();
    setBest(hs.best || 0);
  } catch (e) {
    // offline/blocked: keep 0
    setBest(0);
  }
}

// -------------------------
// PDF/Test (print-to-PDF)
// -------------------------
$("pdfDir").addEventListener("change", (e) => {
  state.pdfDir = e.target.value;
  renderPdfIdle();
});

$("btnBuildPdf").addEventListener("click", () => {
  state.pdfDir = $("pdfDir").value;
  const quiz = buildQuiz(state.pdfDir);

  if (!quiz.length) return;

  // precompute options for en2jp questions
  const quiz2 = quiz.map((x) => {
    if (x.mode === "en2jp") return { ...x, opts: buildChoicesJP(x.q, 8) };
    return x;
  });

  state.pdfQuiz = quiz2;
  $("btnPrintQ").disabled = false;
  $("btnPrintA").disabled = false;
  $("pdfPreview").textContent = `${quiz2.length}`;
});

$("btnPrintQ").addEventListener("click", () => {
  if (!state.pdfQuiz.length) return;
  const pa = $("printArea");
  pa.innerHTML = buildPdfQuestionHTML(state.pdfQuiz);
  pa.classList.remove("hidden");
  window.print();
});

$("btnPrintA").addEventListener("click", () => {
  if (!state.pdfQuiz.length) return;
  const pa = $("printArea");
  pa.innerHTML = buildPdfAnswerHTML(state.pdfQuiz);
  pa.classList.remove("hidden");
  window.print();
});

function renderPdfIdle() {
  $("btnPrintQ").disabled = true;
  $("btnPrintA").disabled = true;
  $("pdfPreview").textContent = "作成→問題PDF / 解答PDF";
  state.pdfQuiz = [];
}

// Printable (A4 1枚に ~50目標)
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

function buildPdfQuestionHTML(quiz) {
  const now = new Date();
  const meta = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")} / ${quiz.length}`;

  let qHtml = "";
  quiz.forEach((x, i) => {
    const q = x.q;
    if (x.mode === "jp2en") {
      qHtml += `
        <div class="q">
          ${i + 1}. <span class="jp">${escapeHTML(q.jp)}</span> <span class="blank"></span>
        </div>`;
    } else {
      const opts = x.opts || buildChoicesJP(q, 8);
      // layout: A-D / E-H
      const first = opts.slice(0, 4)
        .map((jp, k) => `<span>${LETTERS[k]}. <span class="jp">${escapeHTML(jp)}</span></span>`)
        .join("");
      const second = opts.slice(4, 8)
        .map((jp, k) => `<span>${LETTERS[k + 4]}. <span class="jp">${escapeHTML(jp)}</span></span>`)
        .join("");
      qHtml += `
        <div class="q">
          ${i + 1}. <span class="en">${escapeHTML(q.en)}</span>
          <div class="opts">${first}</div>
          <div class="opts">${second}</div>
        </div>`;
    }
  });

  return `
    <div class="sheet">
      <div class="meta">${meta}</div>
      <div class="grid2">${qHtml}</div>
    </div>`;
}

function buildPdfAnswerHTML(quiz) {
  const now = new Date();
  const meta = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")} / ${quiz.length}`;

  let qHtml = "";
  quiz.forEach((x, i) => {
    const q = x.q;
    if (x.mode === "jp2en") {
      qHtml += `
        <div class="q">
          ${i + 1}. <span class="en">${escapeHTML(q.en)}</span>
        </div>`;
    } else {
      const opts = x.opts || buildChoicesJP(q, 8);
      const idx = opts.findIndex((jp) => jp === q.jp);
      const letter = LETTERS[idx >= 0 ? idx : 0];
      qHtml += `
        <div class="q">
          ${i + 1}. ${letter} <span class="jp">${escapeHTML(q.jp)}</span>
        </div>`;
    }
  });

  return `
    <div class="sheet">
      <div class="meta">${meta}</div>
      <div class="grid2">${qHtml}</div>
    </div>`;
}

// -------------------------
// Practice (must correct to move on)
// -------------------------
$("practiceDir").addEventListener("change", (e) => {
  state.practiceDir = e.target.value;
  renderPracticeIdle();
});

$("btnStartPractice").addEventListener("click", () => {
  state.practiceDir = $("practiceDir").value;
  const quiz = buildQuiz(state.practiceDir);
  if (!quiz.length) return;

  // precompute options for en2jp
  state.practiceQuiz = quiz.map((x) => (x.mode === "en2jp" ? { ...x, opts: buildChoicesJP(x.q, 8) } : x));
  state.practiceOn = true;
  state.pracIdx = 0;
  state.pracMist = 0;
  renderPracticeQuestion();
});

$("btnResetPractice").addEventListener("click", () => {
  state.practiceOn = false;
  state.practiceQuiz = [];
  state.pracIdx = 0;
  state.pracMist = 0;
  renderPracticeIdle();
});

function renderPracticeIdle() {
  $("pracProg").textContent = "0/0";
  $("pracMist").textContent = "0";
  $("practiceCard").innerHTML = `<div class="muted">開始</div>`;
}

function renderPracticeQuestion() {
  if (!state.practiceOn || !state.practiceQuiz.length) {
    renderPracticeIdle();
    return;
  }
  if (state.pracIdx >= state.practiceQuiz.length) {
    $("practiceCard").innerHTML = `<div class="muted">END</div>`;
    return;
  }
  const total = state.practiceQuiz.length;
  const x = state.practiceQuiz[state.pracIdx];
  const q = x.q;
  $("pracProg").textContent = `${state.pracIdx + 1}/${total}`;
  $("pracMist").textContent = state.pracMist;

  if (x.mode === "jp2en") {
    $("practiceCard").innerHTML = `
      <div class="jpBig">${escapeHTML(q.jp)}</div>
      <div class="row">
        <input id="pracInput" class="inputBig" type="text" autocomplete="off" />
        <button id="pracSubmit" class="btn primary" type="button">OK</button>
      </div>
      <div id="pracFb" class="feedback"></div>
    `;
    const inp = $("pracInput");
    const fb = $("pracFb");
    const submit = () => {
      const user = normEn(inp.value);
      const ans = normEn(q.en);
      if (user === ans) {
        fb.innerHTML = `<span class="ok">OK</span>`;
        state.pracIdx++;
        setTimeout(renderPracticeQuestion, 80);
      } else {
        state.pracMist++;
        $("pracMist").textContent = state.pracMist;
        fb.innerHTML = `<span class="ng">NG</span>`;
        inp.select();
      }
    };
    $("pracSubmit").addEventListener("click", submit);
    inp.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") submit();
    });
    inp.focus();
  } else {
    const opts = x.opts || buildChoicesJP(q, 8);
    $("practiceCard").innerHTML = `
      <div class="qBig">${escapeHTML(q.en)}</div>
      <div class="choices" id="pracChoices"></div>
      <div id="pracFb" class="feedback"></div>
    `;
    const box = $("pracChoices");
    box.innerHTML = opts.map((jp) => `<div class="choice" data-jp="${escapeHTML(jp)}">${escapeHTML(jp)}</div>`).join("");
    const fb = $("pracFb");

    box.querySelectorAll(".choice").forEach((el) => {
      el.addEventListener("click", () => {
        const jp = el.getAttribute("data-jp");
        if (jp === escapeHTML(q.jp)) {
          el.classList.add("correct");
          fb.innerHTML = `<span class="ok">OK</span>`;
          state.pracIdx++;
          setTimeout(renderPracticeQuestion, 80);
        } else {
          state.pracMist++;
          $("pracMist").textContent = state.pracMist;
          el.classList.add("wrong");
          fb.innerHTML = `<span class="ng">NG</span>`;
        }
      });
    });
  }
}

// -------------------------
// Cards
// -------------------------
$("btnOpenCards").addEventListener("click", () => {
  openCards();
});

$("btnCloseCards").addEventListener("click", () => {
  closeCards();
});

$("btnCardPrev").addEventListener("click", () => {
  if (!state.cardDeck.length) return;
  state.cardIdx = (state.cardIdx - 1 + state.cardDeck.length) % state.cardDeck.length;
  state.cardFace = "en";
  renderCard();
});
$("btnCardNext").addEventListener("click", () => {
  if (!state.cardDeck.length) return;
  state.cardIdx = (state.cardIdx + 1) % state.cardDeck.length;
  state.cardFace = "en";
  renderCard();
});
$("btnCardFlip").addEventListener("click", () => {
  state.cardFace = state.cardFace === "en" ? "jp" : "en";
  renderCard();
});
$("btnCardShuffle").addEventListener("click", () => {
  if (!state.cardDeck.length) return;
  shuffleInPlace(state.cardDeck);
  state.cardIdx = 0;
  state.cardFace = "en";
  renderCard();
});

function openCards() {
  // use current range pool
  updatePoolStats();
  state.cardDeck = [...state.pool];
  if (!state.cardDeck.length) return;
  state.cardOn = true;
  state.cardIdx = 0;
  state.cardFace = "en";

  $("panelCards").classList.remove("hidden");
  $("panelPractice").classList.add("hidden");
  renderCard();
}

function closeCards() {
  state.cardOn = false;
  $("panelCards").classList.add("hidden");
  $("panelPractice").classList.remove("hidden");
}

function renderCard() {
  const n = state.cardDeck.length;
  if (!n) return;
  const q = state.cardDeck[state.cardIdx];
  $("cardProg").textContent = `${state.cardIdx + 1}/${n}`;
  const box = $("cardBox");
  if (state.cardFace === "en") {
    box.innerHTML = `<div class="cardTextEn">${escapeHTML(q.en)}</div>`;
  } else {
    box.innerHTML = `<div class="cardTextJp">${escapeHTML(q.jp)}</div>`;
  }
  box.onclick = () => {
    state.cardFace = state.cardFace === "en" ? "jp" : "en";
    renderCard();
  };
}

// -------------------------
// Game (120s fixed, wrong can proceed)
// -------------------------
$("gameDir").addEventListener("change", (e) => {
  state.gameDir = e.target.value;
  renderGameIdle();
});

$("btnStartGame").addEventListener("click", () => {
  state.gameDir = $("gameDir").value;
  const quiz = buildQuiz(state.gameDir);
  if (!quiz.length) return;

  state.gameQuiz = quiz.map((x) => (x.mode === "en2jp" ? { ...x, opts: buildChoicesJP(x.q, 8) } : x));
  startGame();
});

$("btnStopGame").addEventListener("click", () => stopGame(true));

function renderGameIdle() {
  stopTimer();
  $("hudTime").textContent = "120.0";
  $("hudTime").classList.remove("low");
  $("hudScore").textContent = "0";
  $("hudScore").classList.remove("leader");
  $("hudBest").textContent = state.best;

  $("gameOk").textContent = "0";
  $("gameNg").textContent = "0";
  $("gameStreak").textContent = "0";
  $("gameCard").innerHTML = `<div class="muted">START</div>`;

  $("btnStopGame").disabled = true;
  $("btnStartGame").disabled = false;

  state.gameOn = false;
}

function startGame() {
  stopTimer();
  state.gameOn = true;

  state.gameIdx = 0;
  state.timeLeft = 120.0;
  state.score = 0;
  state.ok = 0;
  state.ng = 0;
  state.streak = 0;
  state.wrongStreak = 0;

  $("btnStopGame").disabled = false;
  $("btnStartGame").disabled = true;

  state.tick = setInterval(() => {
    if (!state.gameOn) return;
    state.timeLeft = Math.max(0, state.timeLeft - 0.1);
    updateGameHUD();
    if (state.timeLeft <= 0) stopGame(true);
  }, 100);

  renderGameQuestion();
}

function stopTimer() {
  if (state.tick) {
    clearInterval(state.tick);
    state.tick = null;
  }
}

async function stopGame(showResult) {
  if (!state.gameOn && showResult) return;
  state.gameOn = false;
  stopTimer();

  $("btnStopGame").disabled = true;
  $("btnStartGame").disabled = false;

  // post highscore (always, to sync best)
  try {
    const r = await apiPostHighScore(state.score);
    setBest(r.best ?? state.best);
  } catch (e) {
    // ignore (offline / static hosting)
  }

  if (showResult) {
    $("gameCard").innerHTML = `<div class="muted">${state.score}</div>`;
  }
}

function updateGameHUD() {
  $("hudTime").textContent = state.timeLeft.toFixed(1);
  $("hudTime").classList.toggle("low", state.timeLeft < 20);

  $("hudScore").textContent = String(state.score);
  $("hudScore").classList.toggle("leader", state.score > state.best);

  $("gameOk").textContent = String(state.ok);
  $("gameNg").textContent = String(state.ng);
  $("gameStreak").textContent = String(state.streak);
}

function nextGameQuestion() {
  if (!state.gameOn) return;
  state.gameIdx++;
  renderGameQuestion();
}

function renderGameQuestion() {
  if (!state.gameOn) return;
  if (!state.gameQuiz.length) return;

  const x = state.gameQuiz[state.gameIdx % state.gameQuiz.length];
  const q = x.q;

  if (x.mode === "jp2en") {
    $("gameCard").innerHTML = `
      <div class="jpBig">${escapeHTML(q.jp)}</div>
      <input id="gameInput" class="inputBig" type="text" autocomplete="off" />
      <div id="gameFb" class="feedback"></div>
    `;
    const inp = $("gameInput");
    const fb = $("gameFb");

    const submit = () => {
      if (!state.gameOn) return;
      const user = normEn(inp.value);
      const ans = normEn(q.en);

      if (user === ans) {
        state.ok++;
        state.streak++;
        state.wrongStreak = 0;
        state.score += 10;
        state.timeLeft = Math.min(999, state.timeLeft + 1);
        fb.innerHTML = `<span class="ok">OK</span>`;
      } else {
        state.ng++;
        state.streak = 0;
        state.wrongStreak++;
        // base penalty
        state.timeLeft = Math.max(0, state.timeLeft - 1);
        // consecutive wrong penalty
        if (state.wrongStreak >= 2) {
          state.score = Math.max(0, state.score - 2);
          state.timeLeft = Math.max(0, state.timeLeft - 2);
        }
        fb.innerHTML = `<span class="ng">NG</span>`;
      }
      updateGameHUD();
      // move on even if wrong
      setTimeout(nextGameQuestion, 80);
    };

    inp.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") submit();
    });
    inp.focus();
  } else {
    const opts = x.opts || buildChoicesJP(q, 8);
    $("gameCard").innerHTML = `
      <div class="qBig">${escapeHTML(q.en)}</div>
      <div class="choices" id="gameChoices"></div>
      <div id="gameFb" class="feedback"></div>
    `;
    const box = $("gameChoices");
    const fb = $("gameFb");
    box.innerHTML = opts.map((jp) => `<div class="choice" data-jp="${escapeHTML(jp)}">${escapeHTML(jp)}</div>`).join("");

    let locked = false;
    box.querySelectorAll(".choice").forEach((el) => {
      el.addEventListener("click", () => {
        if (!state.gameOn || locked) return;
        locked = true;
        const jp = el.getAttribute("data-jp");
        if (jp === escapeHTML(q.jp)) {
          el.classList.add("correct");
          state.ok++;
          state.streak++;
          state.wrongStreak = 0;
          state.score += 10;
          state.timeLeft = Math.min(999, state.timeLeft + 1);
          fb.innerHTML = `<span class="ok">OK</span>`;
        } else {
          el.classList.add("wrong");
          state.ng++;
          state.streak = 0;
          state.wrongStreak++;
          state.timeLeft = Math.max(0, state.timeLeft - 1);
          if (state.wrongStreak >= 2) {
            state.score = Math.max(0, state.score - 2);
            state.timeLeft = Math.max(0, state.timeLeft - 2);
          }
          fb.innerHTML = `<span class="ng">NG</span>`;
        }
        updateGameHUD();
        setTimeout(nextGameQuestion, 80);
      });
    });
  }

  updateGameHUD();
}

// -------------------------
// Boot
// -------------------------
(async function boot() {
  loadWords();
  await initHighScore();
  setMode("pdf");
})();
