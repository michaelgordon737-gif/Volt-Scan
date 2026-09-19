"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const {
  PLAYERS,
  COURT,
  inningNet,
  scoreLanding,
  getState,
  startGame,
  recordBag,
  undoBag,
  setWinner,
} = require("../data-provider/cornhole");

function tmpEnv() {
  const file = path.join(os.tmpdir(), `cornhole-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  return { VOLTSCAN_CORNHOLE_FILE: file };
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

test("landing on the hole, board, or grass is scored by the court", () => {
  assert.equal(scoreLanding(COURT.hole.x, COURT.hole.y), "hole");
  assert.equal(scoreLanding(COURT.board.x + 0.04, COURT.board.y + COURT.board.h - 0.04), "board");
  assert.equal(scoreLanding(0.08, 0.80), "miss");
});

test("cancellation scoring keeps the net only", () => {
  assert.deepEqual(inningNet(["hole", "hole", "miss", "miss"], ["board", "board", "miss", "miss"]), {
    a: 4, b: 0, rawA: 6, rawB: 2,
  });
  assert.deepEqual(inningNet(["board", "board", "board", "board"], ["board", "board", "board", "board"]), {
    a: 0, b: 0, rawA: 4, rawB: 4,
  });
});

test("tonight's schedule seats the nine and advances a winner", () => {
  const env = tmpEnv();
  const state = getState(env);
  assert.equal(state.schedule.now.labelA, "Dillon");
  assert.equal(state.schedule.now.labelB, "Elisha");
  assert.equal(state.schedule.onDeck.labelA, "Shane");
  const played = setWinner("p1", "a", env);
  assert.equal(played.schedule.matches.find((m) => m.id === "q4").labelB, "Dillon");
  assert.equal(played.schedule.now.labelA, "Shane");
  fs.unlinkSync(env.VOLTSCAN_CORNHOLE_FILE);
});

test("roster is the backyard crew and Shane vs Braden opens first", () => {
  const env = tmpEnv();
  const state = getState(env);
  assert.deepEqual(state.players, PLAYERS);
  assert.ok(PLAYERS.includes("Dillon"));
  assert.ok(PLAYERS.includes("Elisha"));
  assert.equal(state.games.length, 1);
  assert.deepEqual(state.games[0].sideA, ["Shane"]);
  assert.deepEqual(state.games[0].sideB, ["Braden"]);
  assert.equal(state.games[0].open, true);
  fs.unlinkSync(env.VOLTSCAN_CORNHOLE_FILE);
});

test("bags, cancel, win at 21, and undo after the win", () => {
  const env = tmpEnv();
  const started = startGame({ sideA: ["Shane", "Noah"], sideB: ["Braden", "Jessie"] }, env);
  const id = started.game.id;
  for (let i = 0; i < 4; i += 1) recordBag(id, "hole", env);
  for (let i = 0; i < 4; i += 1) recordBag(id, "miss", env);
  let state = getState(env);
  let game = state.games.find((g) => g.id === id);
  assert.equal(game.scoreA, 12);
  assert.equal(game.scoreB, 0);
  for (let i = 0; i < 4; i += 1) recordBag(id, "hole", env);
  for (let i = 0; i < 4; i += 1) recordBag(id, "miss", env);
  game = getState(env).games.find((g) => g.id === id);
  assert.equal(game.scoreA, 24);
  assert.equal(game.winner, "a");
  assert.equal(game.open, false);
  assert.equal(state.standings.find((p) => p.name === "Shane").wins, 0);
  const after = getState(env);
  assert.equal(after.standings.find((p) => p.name === "Shane").wins, 1);
  assert.equal(after.standings.find((p) => p.name === "Noah").wins, 1);
  const undone = undoBag(id, env);
  assert.ok(!undone.game.winner);
  assert.equal(undone.game.scoreA, 12);
  fs.unlinkSync(env.VOLTSCAN_CORNHOLE_FILE);
});

test("cornhole HTTP routes score a bag and serve the board at /", async (t) => {
  const env = tmpEnv();
  process.env.VOLTSCAN_CORNHOLE_FILE = env.VOLTSCAN_CORNHOLE_FILE;
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
    delete process.env.VOLTSCAN_CORNHOLE_FILE;
    try { fs.unlinkSync(env.VOLTSCAN_CORNHOLE_FILE); } catch { /* ignore */ }
  });

  const home = await get(port, "/");
  assert.equal(home.status, 200);
  assert.match(home.body, /Tonight's Cornhole/);
  assert.match(home.body, /cornhole\.js/);

  const listed = JSON.parse((await get(port, "/api/cornhole")).body);
  assert.ok(listed.schedule.now);
  assert.equal(listed.schedule.now.labelA, "Dillon");
  assert.ok(listed.players.includes("Geo Pock"));
  const live = listed.games.find((g) => g.open);
  assert.ok(live);

  const bag = await post(port, `/api/cornhole/games/${live.id}/bag`, { kind: "hole" });
  assert.equal(bag.status, 200);
  const scored = JSON.parse(bag.body).game;
  assert.equal(scored.current.aBags[0].kind, "hole");
  assert.equal(scored.current.throwing, "a");
  assert.equal(scored.current.bag, 2);

  const tossed = JSON.parse((await post(port, `/api/cornhole/games/${live.id}/bag`, {
    x: listed.court.hole.x,
    y: listed.court.hole.y,
  })).body);
  assert.equal(tossed.bag.kind, "hole");
  assert.equal(tossed.game.current.aBags[1].kind, "hole");
});
