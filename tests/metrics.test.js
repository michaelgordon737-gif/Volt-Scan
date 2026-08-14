"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  relativeVolume,
  dailyRelativeVolume,
  volatilityScore,
  pctChange,
} = require("../data-provider/metrics");
const { aggregateBars } = require("../data-provider/alpaca-provider");
const { DemoMarketDataProvider } = require("../data-provider/demo-provider");
const { SOURCE } = require("../data-provider/sources");

test("relative volume is current / average prior", () => {
  assert.equal(relativeVolume(200, [100, 100]), 2);
  assert.equal(relativeVolume(50, [100]), 0.5);
  assert.equal(relativeVolume(10, []), null);
  assert.equal(relativeVolume(null, [1]), null);
});

test("daily RVOL uses the same formula", () => {
  assert.equal(dailyRelativeVolume(30, [10, 20]), 2);
});

test("pctChange is null when baseline missing", () => {
  assert.equal(pctChange(10, 0), null);
  assert.equal(pctChange(110, 100), 10);
});

test("volatility score is deterministic and bounded", () => {
  const a = volatilityScore({
    last: 110,
    prevClose: 100,
    open: 100,
    high: 112,
    low: 99,
    shortTermPct: 2,
    rvol: 2,
  });
  const b = volatilityScore({
    last: 110,
    prevClose: 100,
    open: 100,
    high: 112,
    low: 99,
    shortTermPct: 2,
    rvol: 2,
  });
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 100);
});

test("volatility score is N/A with no inputs", () => {
  assert.equal(volatilityScore({}), null);
});

test("aggregateBars rolls 1-minute bars into 5-minute bars", () => {
  const start = Date.parse("2026-08-13T13:30:00.000Z");
  const bars = [];
  for (let i = 0; i < 5; i++) {
    bars.push({
      t: new Date(start + i * 60 * 1000).toISOString(),
      o: 10 + i,
      h: 11 + i,
      l: 9 + i,
      c: 10.5 + i,
      v: 100,
    });
  }
  const agg = aggregateBars(bars, "5Min");
  assert.equal(agg.length, 1);
  assert.equal(agg[0].o, 10);
  assert.equal(agg[0].c, 14.5);
  assert.equal(agg[0].h, 15);
  assert.equal(agg[0].l, 9);
  assert.equal(agg[0].v, 500);
});

test("demo snapshots are labeled DEMO and never pretend to be live", async () => {
  const demo = new DemoMarketDataProvider();
  const status = demo.getStatus();
  assert.equal(status.mode, "demo");
  assert.equal(status.label, "DEMO DATA");
  assert.equal(status.live, false);
  const snap = await demo.getSnapshot("AAPL");
  assert.equal(snap.source, SOURCE.DEMO);
  assert.equal(snap.last.source, SOURCE.DEMO);
  assert.equal(snap.freeFloat.value, null);
  assert.equal(snap.freeFloat.source, SOURCE.UNAVAILABLE);
});
