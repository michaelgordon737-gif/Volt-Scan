"use strict";

const meKey = "cornhole-me";
const app = document.getElementById("app");
const nowEl = document.getElementById("now");
const hudEl = document.getElementById("hud");
const hintEl = document.getElementById("hint");
const meBtn = document.getElementById("meBtn");
const undoBtn = document.getElementById("undoBtn");
const toastEl = document.getElementById("toast");
const canvas = document.getElementById("court");
const ctx = canvas.getContext("2d");

let state = null;
let sideA = [];
let sideB = [];
let flying = null;
let aim = null;
let busy = false;

function court() {
  return state && state.court || {
    board: { x: 0.29, y: 0.08, w: 0.42, h: 0.30 },
    hole: { x: 0.50, y: 0.155, r: 0.052 },
    throwLine: { x: 0.50, y: 0.84 },
  };
}

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
  renderHud();
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1600);
}

function bagKind(bag) {
  return typeof bag === "string" ? bag : (bag && bag.kind) || "";
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

function liveGame() {
  return (state && state.games || []).find((g) => g.open) || null;
}

function landOnCourt() {
  canvas.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bagDots(bags, need) {
  const cells = [];
  for (let i = 0; i < need; i += 1) {
    cells.push(`<span class="bag ${bagKind(bags[i])}"></span>`);
  }
  return `<div class="bags">${cells.join("")}</div>`;
}

function renderHud() {
  if (!state) return;
  const who = me();
  meBtn.textContent = who ? `I'm ${who}` : "Who am I?";
  const game = liveGame() || state.games[0];
  if (!game) {
    nowEl.textContent = "Start a game";
    hudEl.innerHTML = "";
    return;
  }
  const cur = game.current;
  nowEl.textContent = game.winner
    ? `${game.winner === "a" ? game.labelA : game.labelB} wins ${game.scoreA}–${game.scoreB}`
    : `${cur.thrower} throwing · bag ${cur.bag} of ${state.bagsPerInning}`;
  hintEl.textContent = game.winner
    ? "Game over · pick the next matchup below"
    : busy ? "Bag in the air…" : "Pull the bag back · let go to throw";
  hudEl.innerHTML = `
    <div class="side ${cur && cur.throwing === "a" ? "up" : ""}">
      <div class="label">${game.labelA}</div>
      <div class="score">${game.scoreA}</div>
      ${bagDots(cur ? cur.aBags : [], state.bagsPerInning)}
    </div>
    <div class="vs">VS</div>
    <div class="side ${cur && cur.throwing === "b" ? "up" : ""}">
      <div class="label">${game.labelB}</div>
      <div class="score">${game.scoreB}</div>
      ${bagDots(cur ? cur.bBags : [], state.bagsPerInning)}
    </div>
  `;
}

function renderMeta() {
  if (!state) return;
  const chips = state.players.map((name) => {
    const side = sideA.includes(name) ? "a" : sideB.includes(name) ? "b" : "";
    return `<button class="name ${side}" data-pick="${name}" type="button">${name}</button>`;
  }).join("");
  const rows = (state.standings || []).map((p) => `<div class="game"><span>${p.name}</span><strong>${p.wins} win${p.wins === 1 ? "" : "s"}</strong></div>`).join("");
  const games = (state.games || []).map((g) => {
    const mark = g.winner ? (g.winner === "a" ? `${g.labelA} won` : `${g.labelB} won`) : "live";
    return `<div class="game"><span>${g.labelA} ${g.scoreA}–${g.scoreB} ${g.labelB}</span><strong>${mark}</strong></div>`;
  }).join("");
  const live = liveGame();
  app.innerHTML = `
    ${live && live.winner ? "" : live ? "" : ""}
    <section class="card" id="newgame">
      <h2>Next game</h2>
      <p class="hint">Tap a name for side A, tap again for side B. 1v1 or 2v2.</p>
      <div class="names">${chips}</div>
      <p class="hint">A: ${sideA.join(" / ") || "—"} · B: ${sideB.join(" / ") || "—"}</p>
      <button class="primary" data-start type="button">Start game</button>
    </section>
    <section class="card">
      <h2>Board</h2>
      <div class="games">${rows}</div>
      <h2>Games</h2>
      <div class="games">${games}</div>
    </section>
  `;
}

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function px(nx, ny) {
  return [nx * canvas.clientWidth, ny * canvas.clientHeight];
}

function fromPx(clientX, clientY) {
  const box = canvas.getBoundingClientRect();
  return {
    x: (clientX - box.left) / box.width,
    y: (clientY - box.top) / box.height,
  };
}

function drawBag(nx, ny, side, scale, lift) {
  const [x, y] = px(nx, ny);
  const s = (scale || 1) * Math.min(canvas.clientWidth, canvas.clientHeight) * 0.034;
  ctx.save();
  ctx.translate(x, y - (lift || 0) * canvas.clientHeight);
  ctx.rotate(-0.18);
  ctx.fillStyle = "rgba(0,0,0,.28)";
  ctx.fillRect(-s * 0.7, s * 0.35, s * 1.5, s * 0.45);
  ctx.fillStyle = side === "b" ? "#2a4a8a" : "#c23b2e";
  ctx.strokeStyle = side === "b" ? "#16315e" : "#7a1f18";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-s, -s * 0.7, s * 2, s * 1.4, 6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function settledBags() {
  const game = liveGame() || (state && state.games[0]);
  if (!game) return [];
  const inn = game.current || (game.innings && game.innings[game.innings.length - 1]) || {};
  const out = [];
  (inn.aBags || []).forEach((bag) => {
    if (bag && Number.isFinite(bag.x)) out.push({ ...bag, side: "a" });
  });
  (inn.bBags || []).forEach((bag) => {
    if (bag && Number.isFinite(bag.x)) out.push({ ...bag, side: "b" });
  });
  return out;
}

function draw() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const c = court();
  ctx.clearRect(0, 0, w, h);
  const grass = ctx.createLinearGradient(0, 0, 0, h);
  grass.addColorStop(0, "#2f6a28");
  grass.addColorStop(1, "#1d4319");
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,.06)";
  for (let i = 0; i < 8; i += 1) ctx.fillRect(0, (i / 8) * h, w, 2);

  const [bx, by] = px(c.board.x, c.board.y);
  const bw = c.board.w * w;
  const bh = c.board.h * h;
  ctx.fillStyle = "#6b3b16";
  ctx.fillRect(bx - 6, by - 6, bw + 12, bh + 18);
  const wood = ctx.createLinearGradient(bx, by, bx + bw, by);
  wood.addColorStop(0, "#b86a2c");
  wood.addColorStop(0.5, "#d9893b");
  wood.addColorStop(1, "#a85d22");
  ctx.fillStyle = wood;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "rgba(80,40,12,.35)";
  for (let i = 1; i < 6; i += 1) {
    ctx.beginPath();
    ctx.moveTo(bx + 8, by + (bh * i) / 6);
    ctx.lineTo(bx + bw - 8, by + (bh * i) / 6);
    ctx.stroke();
  }

  const [hx, hy] = px(c.hole.x, c.hole.y);
  const hr = c.hole.r * Math.min(w, h * 1.15);
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  ctx.fillStyle = "#102038";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx, hy, hr * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = "#070d16";
  ctx.fill();

  const [tx, ty] = px(c.throwLine.x, c.throwLine.y);
  ctx.strokeStyle = "rgba(246,234,214,.35)";
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(18, ty);
  ctx.lineTo(w - 18, ty);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(246,234,214,.7)";
  ctx.font = "700 13px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.fillText("THROW", tx, ty + 28);

  for (const bag of settledBags()) {
    if (bag.kind === "hole") drawBag(c.hole.x, c.hole.y, bag.side, 0.55, 0);
    else drawBag(bag.x, bag.y, bag.side, 1, 0);
  }

  const game = liveGame();
  const side = game && game.current ? game.current.throwing : "a";
  if (aim) {
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 6]);
    const [ax, ay] = px(aim.x0, aim.y0);
    const [bx2, by2] = px(aim.x0 + (aim.x0 - aim.x1), aim.y0 + (aim.y0 - aim.y1));
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx2, by2);
    ctx.stroke();
    ctx.setLineDash([]);
    drawBag(aim.x1, aim.y1, side, 1.1, 0);
    const ghost = aimPower({ x: aim.x0, y: aim.y0 }, { x: aim.x1, y: aim.y1 });
    if (ghost) {
      ctx.globalAlpha = 0.4;
      drawBag(ghost.x, ghost.y, side, 0.9, 0);
      ctx.globalAlpha = 1;
    }
  } else if (flying) {
    drawBag(flying.x, flying.y, side, 1.15, flying.lift);
  } else if (game && !game.winner) {
    drawBag(c.throwLine.x, c.throwLine.y, side, 1, 0);
  }
}

function animateThrow(target, side) {
  return new Promise((resolve) => {
    const c = court();
    const start = { x: c.throwLine.x, y: c.throwLine.y };
    const t0 = performance.now();
    const dur = 620;
    flying = { x: start.x, y: start.y, lift: 0 };
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const ease = 1 - (1 - t) ** 3;
      flying.x = start.x + (target.x - start.x) * ease;
      flying.y = start.y + (target.y - start.y) * ease;
      flying.lift = Math.sin(Math.PI * t) * 0.12;
      draw();
      if (t < 1) requestAnimationFrame(tick);
      else {
        flying = { x: target.x, y: target.y, lift: 0, side };
        draw();
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

function aimPower(start, end) {
  const pulledBack = end.y >= start.y - 0.01;
  const dx = pulledBack ? start.x - end.x : end.x - start.x;
  const dy = pulledBack ? start.y - end.y : end.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.035) return null;
  const power = Math.min(0.92, dist * (pulledBack ? 3.4 : 1.12));
  return {
    x: Math.min(0.96, Math.max(0.04, start.x + (dx / dist) * power)),
    y: Math.min(0.96, Math.max(0.04, start.y + (dy / dist) * power)),
  };
}

async function finishThrow(target) {
  const live = liveGame();
  if (!live) return;
  busy = true;
  renderHud();
  await animateThrow(target, live.current.throwing);
  const result = await api(`/api/cornhole/games/${live.id}/bag`, { x: target.x, y: target.y });
  const kind = bagKind(result.bag);
  toast(kind === "hole" ? "HOLE" : kind === "board" ? "On the board" : "Miss");
  flying = null;
  busy = false;
  await refresh();
  landOnCourt();
}

function onPointerDown(e) {
  const game = liveGame();
  if (!game || game.winner || busy) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  const p = fromPx(e.clientX, e.clientY);
  const line = court().throwLine;
  aim = { x0: line.x, y0: line.y, x1: p.x, y1: p.y };
  draw();
}

function onPointerMove(e) {
  if (!aim) return;
  e.preventDefault();
  const p = fromPx(e.clientX, e.clientY);
  aim.x1 = p.x;
  aim.y1 = p.y;
  draw();
}

async function onPointerUp(e) {
  if (!aim) return;
  e.preventDefault();
  const start = { x: aim.x0, y: aim.y0 };
  const end = { x: aim.x1, y: aim.y1 };
  aim = null;
  const target = aimPower(start, end);
  draw();
  if (!target) {
    toast("Pull back more");
    return;
  }
  try {
    await finishThrow(target);
  } catch (err) {
    flying = null;
    busy = false;
    toast(err.message);
    draw();
  }
}

async function refresh() {
  const prev = liveGame() && liveGame().id;
  state = await api("/api/cornhole");
  renderHud();
  if (!app.dataset.ready) {
    renderMeta();
    app.dataset.ready = "1";
  } else {
    const standings = app.querySelector(".games");
    if (standings) renderMeta();
  }
  if (!flying && !aim) draw();
  if (liveGame() && liveGame().id !== prev) landOnCourt();
}

async function startGame() {
  const game = (await api("/api/cornhole/games", { sideA, sideB })).game;
  toast(`${game.labelA} vs ${game.labelB}`);
  await refresh();
  landOnCourt();
}

async function undoBag() {
  const live = liveGame() || (state && state.games[0]);
  if (!live) return;
  await api(`/api/cornhole/games/${live.id}/undo`, {});
  await refresh();
  landOnCourt();
}

meBtn.addEventListener("click", () => {
  const names = state?.players || [];
  const next = names[(names.indexOf(me()) + 1) % names.length] || names[0];
  if (next) setMe(next);
});

undoBtn.addEventListener("click", () => undoBag().catch((err) => toast(err.message)));

app.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-pick],[data-start]");
  if (!t) return;
  try {
    if (t.dataset.pick) {
      const name = t.dataset.pick;
      if (sideA.includes(name)) {
        sideA = sideA.filter((n) => n !== name);
        sideB.push(name);
      } else if (sideB.includes(name)) {
        sideB = sideB.filter((n) => n !== name);
      } else {
        sideA.push(name);
      }
      renderMeta();
    } else if (t.dataset.start != null) {
      await startGame();
    }
  } catch (err) {
    toast(err.message);
  }
});

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", () => { aim = null; draw(); });
window.addEventListener("resize", () => { sizeCanvas(); draw(); });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

sizeCanvas();
draw();
refresh().catch((err) => toast(err.message));
setInterval(() => {
  if (busy || aim) return;
  refresh().catch(() => {});
}, 1500);
