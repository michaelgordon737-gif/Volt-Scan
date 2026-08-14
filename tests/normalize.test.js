"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { optionalNumber, SOURCE, FEED } = require("../data-provider/sources");
const { normalizeRow } = require("../data-provider/demo-provider");

test("optionalNumber does not treat null as zero", () => {
  assert.equal(optionalNumber(null), null);
  assert.equal(optionalNumber(undefined), null);
  assert.equal(optionalNumber(""), null);
  assert.equal(optionalNumber("0"), 0);
  assert.equal(optionalNumber(12.5), 12.5);
});

test("rows without a snapshot are UNAVAILABLE, not DEMO zeros", () => {
  const row = normalizeRow({ ticker: "ZZZZ", name: "Z", type: "CS" }, null, null);
  assert.equal(row.ticker, "ZZZZ");
  assert.equal(row.price, null);
  assert.equal(row.volume, null);
  assert.equal(row.changePct, null);
  assert.equal(row.source, SOURCE.UNAVAILABLE);
});

test("FEED names are the Alpaca snapshot feed ids", () => {
  assert.equal(FEED.SIP_DELAYED, ["delayed", "sip"].join("_"));
  assert.equal(FEED.IEX, "iex");
  assert.equal(FEED.SIP, "sip");
});
