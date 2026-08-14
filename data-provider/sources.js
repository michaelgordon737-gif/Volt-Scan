"use strict";

/** Canonical source / status tags for every market-derived field. */
const SOURCE = {
  ALPACA_SIP_DELAYED: "ALPACA_SIP_DELAYED",
  ALPACA_IEX: "ALPACA_IEX",
  ALPACA_SIP: "ALPACA_SIP",
  DEMO: "DEMO",
  UNAVAILABLE: "UNAVAILABLE",
  STALE: "STALE",
};

/** Alpaca market-data feed names. SIP_DELAYED is the 15-minute delayed consolidated tape. */
const FEED = {
  SIP_DELAYED: ["delayed", "sip"].join("_"),
  IEX: "iex",
  SIP: "sip",
};

const FEED_META = {
  [FEED.SIP_DELAYED]: {
    source: SOURCE.ALPACA_SIP_DELAYED,
    delayLabel: "15 MIN DELAYED",
    headerLabel: "ALPACA • 15 MIN DELAYED",
    live: false,
  },
  [FEED.IEX]: {
    source: SOURCE.ALPACA_IEX,
    delayLabel: "IEX REAL-TIME",
    headerLabel: "ALPACA • IEX REAL-TIME",
    live: true,
    coverageNote:
      "IEX is a single exchange (~2–3% of U.S. volume), not consolidated SIP. RVOL and volume-based scans are incomplete.",
  },
  [FEED.SIP]: {
    source: SOURCE.ALPACA_SIP,
    delayLabel: "SIP REAL-TIME",
    headerLabel: "ALPACA • SIP REAL-TIME",
    live: true,
  },
};

function field(value, source, extra = {}) {
  const unavailable =
    value === null ||
    value === undefined ||
    (typeof value === "number" && !Number.isFinite(value));
  return {
    value: unavailable ? null : value,
    source: unavailable ? SOURCE.UNAVAILABLE : source,
    ...extra,
  };
}

function naField(note) {
  return { value: null, source: SOURCE.UNAVAILABLE, note: note || null };
}

function displayLabel(source) {
  switch (source) {
    case SOURCE.ALPACA_SIP_DELAYED:
      return "15 MIN DELAYED";
    case SOURCE.ALPACA_IEX:
      return "IEX REAL-TIME";
    case SOURCE.ALPACA_SIP:
      return "SIP REAL-TIME";
    case SOURCE.DEMO:
      return "DEMO";
    case SOURCE.STALE:
      return "STALE";
    default:
      return "UNAVAILABLE";
  }
}

/** Parse a number, treating null/empty as missing. `Number(null) === 0` must not become a real price or filter. */
function optionalNumber(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  SOURCE,
  FEED,
  FEED_META,
  field,
  naField,
  displayLabel,
  optionalNumber,
};
