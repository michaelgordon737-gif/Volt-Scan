"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PLAYERS = [
  "Shane", "Braden", "Noah", "Jessie", "Blake",
  "Andrew", "Geo Pock", "Dillon", "Elisha",
];
const BAGS_PER_INNING = 4;
const WIN_SCORE = 21;
const COURT = {
  board: { x: 0.29, y: 0.08, w: 0.42, h: 0.30 },
  hole: { x: 0.50, y: 0.155, r: 0.052 },
  throwLine: { x: 0.50, y: 0.84 },
};

function bagKind(bag) {
  return typeof bag === "string" ? bag : (bag && bag.kind) || "miss";
}

function storePath(env = process.env) {
  return env.VOLTSCAN_CORNHOLE_FILE
    || path.join(__dirname, "..", "data", "cornhole.json");
}

function newId() {
  return crypto.randomBytes(6).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function bagPoints(bag) {
  const kind = bagKind(bag);
  if (kind === "hole") return 3;
  if (kind === "board") return 1;
  return 0;
}

function scoreLanding(x, y) {
  const dx = x - COURT.hole.x;
  const dy = y - COURT.hole.y;
  if ((dx * dx) + (dy * dy) <= COURT.hole.r * COURT.hole.r) return "hole";
  const b = COURT.board;
  if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return "board";
  return "miss";
}

function normalizeBag(input) {
  if (typeof input === "string") {
    if (!["hole", "board", "miss"].includes(input)) return { error: "Bag must be hole, board, or miss.", status: 400 };
    return { kind: input };
  }
  const x = Number(input && input.x);
  const y = Number(input && input.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { kind: scoreLanding(x, y), x, y };
  }
  const kind = input && input.kind;
  if (!["hole", "board", "miss"].includes(kind)) return { error: "Bag must be hole, board, or miss.", status: 400 };
  return { kind };
}

function inningNet(aBags, bBags) {
  const a = (aBags || []).reduce((s, k) => s + bagPoints(k), 0);
  const b = (bBags || []).reduce((s, k) => s + bagPoints(k), 0);
  if (a > b) return { a: a - b, b: 0, rawA: a, rawB: b };
  if (b > a) return { a: 0, b: b - a, rawA: a, rawB: b };
  return { a: 0, b: 0, rawA: a, rawB: b };
}

function emptyStore() {
  return {
    name: "Backyard Cornhole",
    players: PLAYERS.slice(),
    games: [],
  };
}

function readStore(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || !Array.isArray(data.players) || !Array.isArray(data.games)) return emptyStore();
    for (const name of PLAYERS) {
      if (!data.players.includes(name)) data.players.push(name);
    }
    return data;
  } catch {
    return emptyStore();
  }
}

function writeStore(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function load(env = process.env) {
  const file = storePath(env);
  const store = readStore(file);
  writeStore(file, store);
  return { file, store };
}

function labelSide(names) {
  return (names || []).join(" / ");
}

function publicGame(g) {
  const inn = g.innings[g.innings.length - 1];
  const throwing = inn && inn.aBags.length < BAGS_PER_INNING ? "a"
    : inn && inn.bBags.length < BAGS_PER_INNING ? "b"
    : null;
  return {
    id: g.id,
    sideA: g.sideA,
    sideB: g.sideB,
    labelA: labelSide(g.sideA),
    labelB: labelSide(g.sideB),
    scoreA: g.scoreA,
    scoreB: g.scoreB,
    winner: g.winner,
    open: !g.winner,
    innings: g.innings,
    current: inn && !g.winner ? {
      n: g.innings.length,
      aBags: inn.aBags,
      bBags: inn.bBags,
      throwing,
      thrower: throwing === "a" ? labelSide(g.sideA) : throwing === "b" ? labelSide(g.sideB) : null,
      bag: throwing === "a" ? inn.aBags.length + 1 : throwing === "b" ? inn.bBags.length + 1 : null,
    } : null,
  };
}

function getState(env = process.env) {
  const { file, store } = load(env);
  seedOpener(store, file);
  return {
    name: store.name,
    players: store.players,
    winScore: WIN_SCORE,
    bagsPerInning: BAGS_PER_INNING,
    court: COURT,
    standings: standings(store),
    games: store.games.map(publicGame),
  };
}

function startGame({ sideA, sideB }, env = process.env) {
  const a = [...new Set((sideA || []).map((n) => String(n).trim()).filter(Boolean))];
  const b = [...new Set((sideB || []).map((n) => String(n).trim()).filter(Boolean))];
  if (!a.length || !b.length) return { error: "Pick at least one name for each side.", status: 400 };
  if (a.some((n) => b.includes(n))) return { error: "A player cannot be on both sides.", status: 400 };
  const { file, store } = load(env);
  const game = {
    id: newId(),
    sideA: a,
    sideB: b,
    scoreA: 0,
    scoreB: 0,
    winner: null,
    innings: [{ aBags: [], bBags: [] }],
    createdAt: nowIso(),
  };
  store.games.unshift(game);
  writeStore(file, store);
  return { game: publicGame(game) };
}

function recordBag(id, input, env = process.env) {
  const bag = normalizeBag(input);
  if (bag.error) return bag;
  const { file, store } = load(env);
  const g = store.games.find((x) => x.id === id);
  if (!g) return { error: "Game not found.", status: 404 };
  if (g.winner) return { error: "This game is already over.", status: 409 };
  let inn = g.innings[g.innings.length - 1];
  if (inn.aBags.length < BAGS_PER_INNING) inn.aBags.push(bag);
  else if (inn.bBags.length < BAGS_PER_INNING) inn.bBags.push(bag);
  else return { error: "Inning is full.", status: 409 };

  if (inn.aBags.length === BAGS_PER_INNING && inn.bBags.length === BAGS_PER_INNING) {
    const net = inningNet(inn.aBags, inn.bBags);
    inn.netA = net.a;
    inn.netB = net.b;
    g.scoreA += net.a;
    g.scoreB += net.b;
    if (g.scoreA >= WIN_SCORE || g.scoreB >= WIN_SCORE) {
      if (g.scoreA !== g.scoreB) g.winner = g.scoreA > g.scoreB ? "a" : "b";
    }
    if (!g.winner) g.innings.push({ aBags: [], bBags: [] });
  }
  writeStore(file, store);
  return { game: publicGame(g), bag };
}

function rewindCompletedInning(g, inn) {
  g.scoreA -= inn.netA || 0;
  g.scoreB -= inn.netB || 0;
  delete inn.netA;
  delete inn.netB;
  g.winner = null;
}

function undoBag(id, env = process.env) {
  const { file, store } = load(env);
  const g = store.games.find((x) => x.id === id);
  if (!g) return { error: "Game not found.", status: 404 };
  let inn = g.innings[g.innings.length - 1];
  if (!inn.aBags.length && !inn.bBags.length && g.innings.length > 1) {
    g.innings.pop();
    inn = g.innings[g.innings.length - 1];
    rewindCompletedInning(g, inn);
  } else if (inn.netA != null || inn.netB != null) {
    rewindCompletedInning(g, inn);
  }
  if (inn.bBags.length) inn.bBags.pop();
  else if (inn.aBags.length) inn.aBags.pop();
  else return { error: "Nothing to undo.", status: 409 };
  writeStore(file, store);
  return { game: publicGame(g) };
}

function standings(store) {
  const wins = Object.fromEntries((store.players || []).map((n) => [n, 0]));
  for (const g of store.games) {
    if (!g.winner) continue;
    const names = g.winner === "a" ? g.sideA : g.sideB;
    for (const name of names) {
      if (wins[name] == null) wins[name] = 0;
      wins[name] += 1;
    }
  }
  return Object.entries(wins)
    .map(([name, wins]) => ({ name, wins }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
}

function seedOpener(store, file) {
  if (store.games.length) return;
  store.games.unshift({
    id: newId(),
    sideA: ["Shane"],
    sideB: ["Braden"],
    scoreA: 0,
    scoreB: 0,
    winner: null,
    innings: [{ aBags: [], bBags: [] }],
    createdAt: nowIso(),
  });
  writeStore(file, store);
}

module.exports = {
  PLAYERS,
  BAGS_PER_INNING,
  WIN_SCORE,
  COURT,
  bagKind,
  bagPoints,
  scoreLanding,
  inningNet,
  getState,
  startGame,
  recordBag,
  undoBag,
  publicGame,
  standings,
};
