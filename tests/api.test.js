"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { app } = require("../server");

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
      })
      .on("error", reject);
  });
}

test("API and UI routes work in demo mode without Alpaca keys", async (t) => {
  const prevKey = process.env.ALPACA_API_KEY;
  const prevSecret = process.env.ALPACA_SECRET_KEY;
  delete process.env.ALPACA_API_KEY;
  delete process.env.ALPACA_SECRET_KEY;
  const { resetProvider } = require("../data-provider");
  resetProvider();

  const { server, port } = await listen();
  t.after(() => {
    server.close();
    if (prevKey !== undefined) process.env.ALPACA_API_KEY = prevKey;
    else delete process.env.ALPACA_API_KEY;
    if (prevSecret !== undefined) process.env.ALPACA_SECRET_KEY = prevSecret;
    else delete process.env.ALPACA_SECRET_KEY;
    resetProvider();
  });

  const health = await get(port, "/health");
  assert.equal(health.status, 200);

  const status = JSON.parse((await get(port, "/api/status")).body);
  assert.equal(status.mode, "demo");
  assert.equal(status.label, "DEMO DATA");
  assert.equal(status.credentialsConfigured, false);
  assert.equal(status.notifications.closedAppPush, false);

  const home = await get(port, "/");
  assert.equal(home.status, 200);
  assert.match(home.body, /VoltScan/);
  assert.match(home.body, /data-nav="watchlist"/);

  const appJs = await get(port, "/js/app.js?v=3");
  assert.equal(appJs.status, 200);
  assert.match(appJs.body, /function ruleSummary/);
  assert.match(appJs.body, /data-open-symbol/);
  assert.match(appJs.body, /Candlestick/);

  const quote = JSON.parse((await get(port, "/api/quote/AAPL")).body);
  assert.equal(quote.symbol, "AAPL");
  assert.equal(quote.source, "DEMO");
  assert.equal(quote.freeFloat.value, null);

  const bars = JSON.parse((await get(port, "/api/bars/AAPL?timeframe=5Min")).body);
  assert.ok(Array.isArray(bars.bars) && bars.bars.length > 10);
  assert.ok(bars.bars[0].v > 0);

  const detail = JSON.parse((await get(port, "/api/detail/AAPL?timeframe=1Min")).body);
  assert.ok(detail.bars.length);
  assert.equal(detail.rvol.source, "DEMO");

  const scanner = JSON.parse((await get(port, "/api/scanner")).body);
  assert.ok(scanner.gainers.length);
  assert.equal(scanner.coverage.fullMarket, false);
  assert.match(scanner.coverage.label, /DEMO|Limited|universe/i);
});

test("frontend still contains info buttons and chart controls", () => {
  const js = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
  assert.match(js, /function ruleSummary/);
  assert.match(js, /data-info/);
  assert.match(js, /freeFloat/);
  assert.match(js, /volatilityScore/);
  assert.match(js, /data-chart="candle"/);
  assert.match(js, /data-tf/);
  const sw = fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8");
  assert.match(sw, /voltscan-v3/);
});
