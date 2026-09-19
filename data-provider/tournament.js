"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_STARTING_CASH = 100000;
const DEFAULT_DAYS = 7;
const DEFAULT_CODE = "VS-FRIENDS";
const DEFAULT_NAME = "Friends Cup";
const HOST_PLAYER_ID = "host-shane";
const HOST_PLAYER_NAME = "Shane";
const FRIENDS_ROSTER = [
  { id: HOST_PLAYER_ID, name: HOST_PLAYER_NAME },
  { id: "player-braden", name: "Braden" },
  { id: "player-noah", name: "Noah" },
  { id: "player-jessie", name: "Jessie" },
  { id: "player-blake", name: "Blake" },
  { id: "player-andrew", name: "Andrew" },
  { id: "player-geo-pock", name: "Geo Pock" },
];

function storePath(env = process.env) {
  return env.VOLTSCAN_TOURNAMENT_FILE
    || path.join(__dirname, "..", "data", "tournaments.json");
}

function snapshotPrice(s) {
  const p = s?.lastTrade?.p ?? s?.min?.c ?? s?.day?.c;
  const n = +p;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nowIso(d = new Date()) {
  return d.toISOString();
}

function addDays(d, days) {
  return new Date(d.getTime() + days * 86400000);
}

function safeName(v) {
  return String(v || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function safeCode(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16);
}

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

function emptyStore() {
  return { tournaments: [] };
}

function readStore(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tournaments)) return emptyStore();
    return data;
  } catch {
    return emptyStore();
  }
}

function writeStore(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function defaultTournament(at = new Date()) {
  return {
    id: DEFAULT_CODE,
    name: DEFAULT_NAME,
    startingCash: DEFAULT_STARTING_CASH,
    createdAt: nowIso(at),
    startsAt: nowIso(at),
    endsAt: nowIso(addDays(at, DEFAULT_DAYS)),
    players: FRIENDS_ROSTER.map((entry) => rosterPlayer(entry, at)),
    trades: [],
  };
}

function rosterPlayer(entry, at = new Date()) {
  return {
    id: entry.id,
    name: entry.name,
    cash: DEFAULT_STARTING_CASH,
    positions: {},
    joinedAt: nowIso(at),
  };
}

function ensureDefault(store, at = new Date()) {
  if (!store.tournaments.length) store.tournaments.push(defaultTournament(at));
  const cup = store.tournaments.find((t) => t.id === DEFAULT_CODE);
  if (!cup) return store;
  for (const entry of FRIENDS_ROSTER) {
    const exists = cup.players.some((p) =>
      p.id === entry.id || p.name.toLowerCase() === entry.name.toLowerCase()
    );
    if (!exists) cup.players.push(rosterPlayer(entry, at));
  }
  return store;
}

function load(env = process.env) {
  const file = storePath(env);
  const store = ensureDefault(readStore(file));
  writeStore(file, store);
  return { file, store };
}

function publicTournament(t, marks = {}) {
  const players = (t.players || []).map((p) => {
    let equity = p.cash;
    const holdings = Object.entries(p.positions || {}).map(([symbol, qty]) => {
      const mark = marks[symbol] ?? null;
      const value = mark != null ? mark * qty : null;
      if (value != null) equity += value;
      return { symbol, qty, mark, value };
    });
    const ret = ((equity - t.startingCash) / t.startingCash) * 100;
    return {
      id: p.id,
      name: p.name,
      cash: p.cash,
      equity,
      returnPct: ret,
      holdings,
    };
  }).sort((a, b) => b.equity - a.equity);
  players.forEach((p, i) => { p.rank = i + 1; });
  const open = Date.now() < Date.parse(t.endsAt);
  return {
    id: t.id,
    name: t.name,
    startingCash: t.startingCash,
    createdAt: t.createdAt,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    open,
    playerCount: players.length,
    players,
  };
}

function listTournaments(env = process.env) {
  const { store } = load(env);
  return store.tournaments.map((t) => publicTournament(t));
}

function getTournament(id, env = process.env, marks = {}) {
  const { store } = load(env);
  const t = store.tournaments.find((x) => x.id === safeCode(id));
  return t ? publicTournament(t, marks) : null;
}

function createTournament({ name, startingCash, days } = {}, env = process.env, at = new Date()) {
  const { file, store } = load(env);
  const code = `VS-${crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 4)}`;
  const cash = Number(startingCash);
  const t = {
    id: code,
    name: safeName(name) || DEFAULT_NAME,
    startingCash: Number.isFinite(cash) && cash >= 1000 ? Math.round(cash) : DEFAULT_STARTING_CASH,
    createdAt: nowIso(at),
    startsAt: nowIso(at),
    endsAt: nowIso(addDays(at, Number(days) > 0 ? Number(days) : DEFAULT_DAYS)),
    players: [],
    trades: [],
  };
  store.tournaments.unshift(t);
  writeStore(file, store);
  return publicTournament(t);
}

function joinTournament(id, name, env = process.env) {
  const { file, store } = load(env);
  const t = store.tournaments.find((x) => x.id === safeCode(id));
  if (!t) return { error: "Tournament not found.", status: 404 };
  if (Date.now() >= Date.parse(t.endsAt)) return { error: "This tournament is closed.", status: 409 };
  const display = safeName(name);
  if (display.length < 2) return { error: "Pick a name with at least 2 characters.", status: 400 };
  const taken = t.players.some((p) => p.name.toLowerCase() === display.toLowerCase());
  if (taken) return { error: "That name is already in this cup.", status: 409 };
  const player = {
    id: newId(),
    name: display,
    cash: t.startingCash,
    positions: {},
    joinedAt: nowIso(),
  };
  t.players.push(player);
  writeStore(file, store);
  return { tournament: publicTournament(t), player };
}

function applyTrade(t, player, { symbol, side, qty, price }) {
  const q = Math.floor(+qty);
  if (!Number.isFinite(q) || q <= 0) return { error: "Quantity must be a whole number.", status: 400 };
  if (!Number.isFinite(price) || price <= 0) return { error: "No market price for that ticker.", status: 409 };
  const cost = price * q;
  const pos = player.positions[symbol] || 0;
  if (side === "buy") {
    if (player.cash + 1e-9 < cost) return { error: "Not enough cash.", status: 409 };
    player.cash = Math.round((player.cash - cost) * 100) / 100;
    player.positions[symbol] = pos + q;
  } else if (side === "sell") {
    if (pos < q) return { error: "You do not hold that many shares.", status: 409 };
    player.cash = Math.round((player.cash + cost) * 100) / 100;
    const left = pos - q;
    if (left) player.positions[symbol] = left;
    else delete player.positions[symbol];
  } else {
    return { error: "Side must be buy or sell.", status: 400 };
  }
  t.trades.push({
    id: newId(),
    playerId: player.id,
    symbol,
    side,
    qty: q,
    price,
    at: nowIso(),
  });
  return { ok: true };
}

function tradeTournament(id, { playerId, symbol, side, qty, price }, env = process.env) {
  const { file, store } = load(env);
  const t = store.tournaments.find((x) => x.id === safeCode(id));
  if (!t) return { error: "Tournament not found.", status: 404 };
  if (Date.now() >= Date.parse(t.endsAt)) return { error: "This tournament is closed.", status: 409 };
  const player = t.players.find((p) => p.id === String(playerId || ""));
  if (!player) return { error: "Join the cup before you trade.", status: 403 };
  const sym = String(symbol || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 15);
  if (!sym) return { error: "Invalid symbol.", status: 400 };
  const result = applyTrade(t, player, { symbol: sym, side: String(side || "").toLowerCase(), qty, price });
  if (result.error) return result;
  writeStore(file, store);
  const marks = { [sym]: price };
  return { tournament: publicTournament(t, marks), player: publicTournament(t, marks).players.find((p) => p.id === player.id) };
}

module.exports = {
  DEFAULT_CODE,
  DEFAULT_NAME,
  DEFAULT_STARTING_CASH,
  snapshotPrice,
  storePath,
  load,
  listTournaments,
  getTournament,
  createTournament,
  joinTournament,
  tradeTournament,
  publicTournament,
  applyTrade,
  defaultTournament,
  HOST_PLAYER_ID,
  HOST_PLAYER_NAME,
  FRIENDS_ROSTER,
};
