"use strict";

const meKey = "cornhole-me";
const app = document.getElementById("app");
const nowEl = document.getElementById("now");
const meBtn = document.getElementById("meBtn");
const toastEl = document.getElementById("toast");

let state = null;
let sideA = [];
let sideB = [];
let lastFocus = null;

function me() {
  const q = new URLSearchParams(location.search).get("me");
  if (q) {
    localStorage.setItem(meKey, q);
    return q;
  }
  return localStorage.getItem(meKey) || "";
}

function setMe(name) {
  localStorage.setItem(meKey, name);
  const url = new URL(location.href);
  url.searchParams.set("me", name);
  history.replaceState({}, "", url);
  meBtn.textContent = `I'm ${name}`;
  render();
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1600);
}

async function api(path, body) {
  const res = await fetch(path, body == null ? { cache: "no-store" } : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function bagDots(bags, need) {
  const cells = [];
  for (let i = 0; i < need; i += 1) {
    const kind = bags[i] || "";
    cells.push(`<span class="bag ${kind}"></span>`);
  }
  return `<div class="bags">${cells.join("")}</div>`;
}

function liveGame() {
  return (state.games || []).find((g) => g.open) || null;
}

function landOnBoard() {
  const board = document.getElementById("board");
  if (board) board.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderNow(game) {
  if (!game || !game.current) {
    nowEl.hidden = !game || !game.winner;
    nowEl.textContent = game?.winner
      ? `${game.winner === "a" ? game.labelA : game.labelB} just won ${game.scoreA}–${game.scoreB}`
      : "";
    return;
  }
  nowEl.hidden = false;
  nowEl.textContent = `${game.current.thrower} throwing · bag ${game.current.bag} of ${state.bagsPerInning}`;
}

function renderBoard(game) {
  const cur = game.current;
  const throwingA = cur?.throwing === "a";
  const throwingB = cur?.throwing === "b";
  const aBags = cur?.aBags || [];
  const bBags = cur?.bBags || [];
  const winName = game.winner === "a" ? game.labelA : game.winner === "b" ? game.labelB : "";
  return `
    <section class="scoreboard" id="board">
      <div class="sides">
        <div class="side ${throwingA ? "up" : ""}">
          <div class="label">${game.labelA}</div>
          <div class="score">${game.scoreA}</div>
          ${bagDots(aBags, state.bagsPerInning)}
        </div>
        <div class="vs">VS</div>
        <div class="side ${throwingB ? "up" : ""}">
          <div class="label">${game.labelB}</div>
          <div class="score">${game.scoreB}</div>
          ${bagDots(bBags, state.bagsPerInning)}
        </div>
      </div>
      ${game.winner ? `<p class="winner">${winName} wins. First to ${state.winScore}.</p>` : `
        <div class="throws">
          <button class="throw hole" data-bag="hole" type="button">HOLE · 3</button>
          <button class="throw board" data-bag="board" type="button">BOARD · 1</button>
          <button class="throw miss" data-bag="miss" type="button">MISS · 0</button>
        </div>
      `}
      <div class="row">
        <button class="undo" data-undo type="button">Undo last bag</button>
      </div>
    </section>
  `;
}

function renderPicker() {
  const chips = state.players.map((name) => {
    const side = sideA.includes(name) ? "a" : sideB.includes(name) ? "b" : "";
    return `<button class="name ${side}" data-pick="${name}" type="button">${name}</button>`;
  }).join("");
  return `
    <section class="card" id="newgame">
      <h2>Next game</h2>
      <p class="hint">Tap a name for side A, tap again for side B. 1v1 or 2v2.</p>
      <div class="names">${chips}</div>
      <p class="hint">A: ${sideA.join(" / ") || "—"} · B: ${sideB.join(" / ") || "—"}</p>
      <button class="primary" data-start type="button">Start game</button>
    </section>
  `;
}

function renderStandings() {
  const rows = (state.standings || []).map((p) => `<div class="game"><span>${p.name}</span><strong>${p.wins} win${p.wins === 1 ? "" : "s"}</strong></div>`).join("");
  const games = (state.games || []).map((g) => {
    const mark = g.winner ? (g.winner === "a" ? `${g.labelA} won` : `${g.labelB} won`) : "live";
    return `<div class="game"><span>${g.labelA} ${g.scoreA}–${g.scoreB} ${g.labelB}</span><strong>${mark}</strong></div>`;
  }).join("");
  return `
    <section class="card">
      <h2>Board</h2>
      <div class="games">${rows}</div>
      <h2>Games</h2>
      <div class="games">${games || "<p class='hint'>No games yet.</p>"}</div>
    </section>
  `;
}

function render() {
  if (!state) return;
  const who = me();
  meBtn.textContent = who ? `I'm ${who}` : "Who am I?";
  const live = liveGame();
  renderNow(live);
  app.innerHTML = `
    ${live ? renderBoard(live) : (state.games[0] ? renderBoard(state.games[0]) : "")}
    ${renderPicker()}
    ${renderStandings()}
  `;
  if (lastFocus === "board") {
    requestAnimationFrame(() => {
      landOnBoard();
      lastFocus = null;
    });
  }
}

function toggleName(name) {
  if (sideA.includes(name)) {
    sideA = sideA.filter((n) => n !== name);
    sideB.push(name);
  } else if (sideB.includes(name)) {
    sideB = sideB.filter((n) => n !== name);
  } else {
    sideA.push(name);
  }
  render();
}

async function refresh() {
  state = await api("/api/cornhole");
  render();
}

async function startGame() {
  const game = (await api("/api/cornhole/games", { sideA, sideB })).game;
  lastFocus = "board";
  toast(`${game.labelA} vs ${game.labelB}`);
  await refresh();
  landOnBoard();
}

async function throwBag(kind) {
  const live = liveGame();
  if (!live) return;
  lastFocus = "board";
  await api(`/api/cornhole/games/${live.id}/bag`, { kind });
  await refresh();
  landOnBoard();
}

async function undoBag() {
  const live = liveGame() || state.games[0];
  if (!live) return;
  lastFocus = "board";
  await api(`/api/cornhole/games/${live.id}/undo`, {});
  await refresh();
  landOnBoard();
}

meBtn.addEventListener("click", () => {
  const names = state?.players || [];
  const next = names[(names.indexOf(me()) + 1) % names.length] || names[0];
  if (next) setMe(next);
});

app.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-bag],[data-undo],[data-pick],[data-start]");
  if (!t) return;
  try {
    if (t.dataset.bag) await throwBag(t.dataset.bag);
    else if (t.dataset.undo != null) await undoBag();
    else if (t.dataset.pick) toggleName(t.dataset.pick);
    else if (t.dataset.start != null) await startGame();
  } catch (err) {
    toast(err.message);
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

refresh().catch((err) => toast(err.message));
setInterval(() => refresh().catch(() => {}), 1500);
