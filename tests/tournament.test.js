"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const {
  DEFAULT_CODE,
  DEFAULT_STARTING_CASH,
  createTournament,
  joinTournament,
  tradeTournament,
  getTournament,
  applyTrade,
  snapshotPrice,
} = require("../data-provider/tournament");

function tmpEnv() {
  const file = path.join(os.tmpdir(), `voltscan-cup-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  return { VOLTSCAN_TOURNAMENT_FILE: file };
}

function post(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: urlPath,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body || {}));
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

test("Friends Cup is seeded and a player can join and trade", () => {
  const env = tmpEnv();
  const listed = require("../data-provider/tournament").listTournaments(env);
  assert.equal(listed[0].id, DEFAULT_CODE);
  assert.equal(listed[0].startingCash, DEFAULT_STARTING_CASH);
  assert.deepEqual(listed[0].players.map((p) => p.name), ["Shane", "Braden", "Noah", "Jessie", "Blake", "Andrew", "Geo Pock"]);

  const joined = joinTournament(DEFAULT_CODE, "Sam", env);
  assert.equal(joined.player.name, "Sam");
  assert.equal(joined.player.cash, DEFAULT_STARTING_CASH);

  const buy = tradeTournament(DEFAULT_CODE, {
    playerId: joined.player.id,
    symbol: "AAPL",
    side: "buy",
    qty: 10,
    price: 100,
  }, env);
  assert.ok(!buy.error, buy.error);
  assert.equal(buy.player.cash, DEFAULT_STARTING_CASH - 1000);
  assert.equal(buy.player.holdings[0].qty, 10);
  assert.ok(buy.player.equity > buy.player.cash);

  const sell = tradeTournament(DEFAULT_CODE, {
    playerId: joined.player.id,
    symbol: "AAPL",
    side: "sell",
    qty: 10,
    price: 110,
  }, env);
  assert.equal(sell.player.cash, DEFAULT_STARTING_CASH + 100);
  assert.equal(sell.player.holdings.length, 0);
  fs.unlinkSync(env.VOLTSCAN_TOURNAMENT_FILE);
});

test("duplicate names and overselling are rejected", () => {
  const env = tmpEnv();
  const cup = createTournament({ name: "Night Cup" }, env);
  const a = joinTournament(cup.id, "Alex", env);
  const dup = joinTournament(cup.id, "alex", env);
  assert.equal(dup.status, 409);
  const player = { cash: 50, positions: { AAPL: 1 } };
  const t = { trades: [] };
  assert.equal(applyTrade(t, player, { symbol: "AAPL", side: "buy", qty: 1, price: 100 }).status, 409);
  assert.equal(applyTrade(t, player, { symbol: "AAPL", side: "sell", qty: 2, price: 100 }).status, 409);
  fs.unlinkSync(env.VOLTSCAN_TOURNAMENT_FILE);
});

test("snapshotPrice ignores missing quotes", () => {
  assert.equal(snapshotPrice({ lastTrade: { p: 12.5 } }), 12.5);
  assert.equal(snapshotPrice({}), null);
  assert.equal(snapshotPrice(null), null);
});

test("tournament HTTP routes join and mark a demo trade", async (t) => {
  const env = tmpEnv();
  process.env.VOLTSCAN_TOURNAMENT_FILE = env.VOLTSCAN_TOURNAMENT_FILE;
  delete process.env.ALPACA_API_KEY;
  delete process.env.ALPACA_SECRET_KEY;
  const { resetProvider } = require("../data-provider");
  resetProvider();
  delete require.cache[require.resolve("../server")];
  const { server } = require("../server");
  const listening = await new Promise((resolve) => {
    const s = server.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = listening.address().port;
  t.after(() => {
    listening.close();
    delete process.env.VOLTSCAN_TOURNAMENT_FILE;
    try { fs.unlinkSync(env.VOLTSCAN_TOURNAMENT_FILE); } catch { /* ignore */ }
  });

  const list = JSON.parse((await get(port, "/api/tournaments")).body);
  assert.ok(list.tournaments.some((x) => x.id === DEFAULT_CODE));

  const joined = JSON.parse((await post(port, `/api/tournaments/${DEFAULT_CODE}/join`, { name: "Sam" })).body);
  assert.equal(joined.player.name, "Sam");

  const trade = await post(port, `/api/tournaments/${DEFAULT_CODE}/trade`, {
    playerId: joined.player.id,
    symbol: "AAPL",
    side: "buy",
    qty: 1,
  });
  assert.equal(trade.status, 200);
  const body = JSON.parse(trade.body);
  assert.ok(body.player.holdings.some((h) => h.symbol === "AAPL"));

  const detail = JSON.parse((await get(port, `/api/tournaments/${DEFAULT_CODE}`)).body);
  assert.ok(detail.players.some((p) => p.name === "Shane"));
  assert.ok(detail.players.some((p) => p.name === "Sam"));
  assert.ok(getTournament(DEFAULT_CODE, env));
});
