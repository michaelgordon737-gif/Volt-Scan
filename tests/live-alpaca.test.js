"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { credentialsFromEnv, createProvider, SOURCE, FEED } = require("../data-provider");

test("live Alpaca authentication, AAPL, candles, volume, and scanner", async (t) => {
  const creds = credentialsFromEnv();
  if (!creds.configured) {
    t.skip("Alpaca keys are not configured in this environment");
    return;
  }

  const provider = await createProvider();
  const status = provider.getStatus();
  assert.notEqual(status.mode, "demo");
  assert.equal(status.provider, "Alpaca");
  assert.equal(status.hasApiKey, true);
  assert.ok(status.feed, "expected a working Alpaca feed");
  assert.ok(
    [FEED.SIP_DELAYED, FEED.IEX, FEED.SIP].includes(status.feed),
    `unexpected feed ${status.feed}`
  );
  assert.notEqual(status.source, SOURCE.DEMO);
  assert.ok(status.entitlement, "feed entitlement map should be present");
  assert.equal(typeof status.entitlement[FEED.SIP_DELAYED]?.snapshot, "boolean");

  const snaps = await provider.getSnapshots(["AAPL"]);
  const aapl = snaps.tickers[0];
  assert.equal(aapl.ticker, "AAPL");
  assert.notEqual(aapl.source, SOURCE.DEMO);
  assert.ok(aapl.lastTrade && aapl.lastTrade.p > 0, "AAPL last price required");
  assert.ok(aapl.day && aapl.day.v > 0, "AAPL daily volume required");

  const bars = await provider.getBars("AAPL", "5m");
  assert.ok(bars.bars.length > 10, "expected historical candles");
  assert.ok(bars.bars.every((b) => b.source !== SOURCE.DEMO));
  assert.ok(bars.bars.filter((b) => b.v > 0).length > 0, "candles should include volume");

  const gainers = await provider.getGainers();
  assert.equal(gainers.priceDataAvailable, true);
  assert.ok(gainers.tickers.length > 0, "scanner should return priced movers");
  assert.equal(gainers.coverage.fullMarket, false);
  assert.ok(gainers.tickers.every((row) => row.source !== SOURCE.DEMO));

  const market = await provider.getMarket();
  assert.equal(market.priceDataAvailable, true);
  assert.ok(market.rows.length > 0, "market list should not be empty on Alpaca");
  assert.ok(market.rows.some((row) => row.ticker === "AAPL" && row.price > 0));
  assert.ok(market.rows.every((row) => row.source !== SOURCE.DEMO));
});
