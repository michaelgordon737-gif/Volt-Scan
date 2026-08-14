"use strict";

/** Canonical source / status tags for every market-derived field. */
const SOURCE = {
  ALPACA_DELAYED_SIP: "ALPACA_DELAYED_SIP",
  ALPACA_IEX: "ALPACA_IEX",
  ALPACA_SIP: "ALPACA_SIP",
  DEMO: "DEMO",
  UNAVAILABLE: "UNAVAILABLE",
  STALE: "STALE",
};

const FEED_META = {
  delayed_sip: {
    source: SOURCE.ALPACA_DELAYED_SIP,
    delayLabel: "15 MIN DELAYED",
    headerLabel: "ALPACA • 15 MIN DELAYED",
    live: false,
  },
  iex: {
    source: SOURCE.ALPACA_IEX,
    delayLabel: "IEX REAL-TIME",
    headerLabel: "ALPACA • IEX REAL-TIME",
    live: true,
    coverageNote:
      "IEX is a single exchange (~2–3% of U.S. volume), not consolidated SIP. RVOL and volume-based scans are incomplete.",
  },
  sip: {
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
    case SOURCE.ALPACA_DELAYED_SIP:
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

module.exports = {
  SOURCE,
  FEED_META,
  field,
  naField,
  displayLabel,
};
