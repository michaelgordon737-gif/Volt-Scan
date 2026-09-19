"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const path = require("path");

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
}

test("API and original VoltScan UI work in demo mode without Alpaca keys", async (t) => {
  delete process.env.ALPACA_API_KEY;
  delete process.env.ALPACA_SECRET_KEY;
  delete process.env.MASSIVE_API_KEY;
  const { resetProvider } = require("../data-provider");
  resetProvider();
  const { server } = require("../server");
  const listening = await new Promise((resolve) => {
    const s = server.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = listening.address().port;
  t.after(() => listening.close());

  const health = await get(port, "/health");
  assert.equal(health.status, 200);

  const status = JSON.parse((await get(port, "/api/status")).body);
  assert.equal(status.mode, "demo");
  assert.equal(status.label, "DEMO DATA");
  assert.equal(status.hasApiKey, false);
  assert.equal(status.notifications.closedAppPush, false);

  const home = await get(port, "/");
  assert.equal(home.status, 200);
  assert.match(home.body, /Tonight's Cornhole/);

  const scan = await get(port, "/index.html");
  assert.equal(scan.status, 200);
  assert.match(scan.body, /VoltScan/);
  assert.match(scan.body, /data-route="watchlist"/);
  assert.match(scan.body, /data-route="tournament"/);

  const appJs = await get(port, "/app.js?v=alpaca2");
  assert.equal(appJs.status, 200);
  assert.match(appJs.body, /function ruleSummary/);
  assert.match(appJs.body, /data-open/);
  assert.match(appJs.body, /data-charttype="candles"/);

  const market = JSON.parse((await get(port, "/api/market?limit=10")).body);
  assert.ok(market.total > 0, "demo market should list rows when floatMin is omitted");
  assert.ok(market.rows.length > 0);
  assert.equal(market.rows[0].source, "DEMO");

  const snaps = JSON.parse((await get(port, "/api/snapshots?symbols=AAPL")).body);
  assert.equal(snaps.tickers[0].ticker, "AAPL");
  assert.ok(snaps.tickers[0].lastTrade.p > 0);
  assert.equal(snaps.tickers[0].source, "DEMO");

  const bars = JSON.parse((await get(port, "/api/bars/AAPL?interval=5m")).body);
  assert.ok(bars.bars.length > 10);
  assert.ok(bars.bars[0].v > 0);
  assert.ok(Number.isFinite(bars.bars[0].t));

  const detail = JSON.parse((await get(port, "/api/ticker/AAPL")).body);
  assert.equal(detail.ticker.ticker, "AAPL");
  assert.equal(detail.mode, "demo");

  const scanner = JSON.parse((await get(port, "/api/gainers")).body);
  assert.ok(scanner.tickers.length);
  assert.equal(scanner.coverage.fullMarket, false);
});

test("frontend still contains info buttons, charts, and ruleSummary", () => {
  const js = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  assert.match(js, /function ruleSummary/);
  assert.match(js, /data-metricinfo="free-float"/);
  assert.match(js, /data-charttype="candles"/);
  assert.match(js, /data-chartinterval/);
  assert.match(js, /openStockDetail/);
  assert.match(js, /function fitUiToMonitor/);
  assert.match(js, /function renderTournament/);
  assert.match(js, /function joinCup/);
  assert.match(js, /function claimCupName/);
  const sw = fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8");
  assert.match(sw, /backyard-cornhole-v4|backyard-cornhole-v5/);
});
