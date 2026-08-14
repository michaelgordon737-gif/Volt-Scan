"use strict";

const { SOURCE } = require("./sources");
const { UNIVERSE, lookupName, coverageMeta } = require("./universe");

const DEMO_SYMBOLS = [
  "OFA","PLAG","NVDA","AMD","AAPL","TSLA","MSFT","AMZN","META","SOFI",
  "RGTI","IONQ","ACHR","RKLB","SMCI","MARA","RIOT","COIN","HOOD","GME",
  "AMC","SOUN","QBTS","BBAI","LCID","NIO","F","BAC","INTC","MU"
];
const DEMO_BASE = {
  OFA:3.84,PLAG:6.21,NVDA:184.42,AMD:177.16,AAPL:231.18,TSLA:328.44,
  MSFT:521.23,AMZN:225.10,META:758.20,SOFI:24.31
};

function hashSymbol(sym) {
  return [...String(sym)].reduce((a, c) => ((a * 31) + c.charCodeAt(0)) >>> 0, 7);
}

function demoFloat(sym) {
  const h = hashSymbol(sym);
  return {
    free_float: 1_500_000 + (h % 180_000_000),
    free_float_percent: 25 + (h % 7300) / 100,
    effective_date: "DEMO",
  };
}

function demoSnapshot(sym) {
  const h = hashSymbol(sym);
  const base = DEMO_BASE[sym] || (1 + (h % 30000) / 100);
  const now = Date.now();
  const wave = Math.sin((now / 48000) + h) * (0.004 + (h % 17) / 3000);
  const burst = ((h + Math.floor(now / 180000)) % 11 === 0) ? 0.03 : 0;
  const price = Math.max(0.05, base * (1 + wave + burst));
  const daily = (((h % 3200) - 800) / 100) + wave * 100 + burst * 100;
  const prev = price / (1 + daily / 100);
  const open = prev * (1 + ((h % 300) - 120) / 10000);
  const high = Math.max(price, open) * (1.01 + (h % 20) / 1000);
  const low = Math.min(price, open) * (0.99 - (h % 12) / 1200);
  const prevVol = 400000 + (h % 9_000_000);
  const dayVol = Math.round(prevVol * (0.2 + (h % 260) / 100));
  const minOpen = price / (1 + wave * 1.8);
  return {
    ticker: sym,
    todaysChangePerc: daily,
    todaysChange: price - prev,
    updated: now * 1_000_000,
    day: { o: open, h: high, l: low, c: price, v: dayVol },
    prevDay: { c: prev, v: prevVol },
    min: {
      o: minOpen,
      h: Math.max(price, minOpen) * 1.002,
      l: Math.min(price, minOpen) * 0.998,
      c: price,
      v: 2000 + (h % 180000),
      av: dayVol,
    },
    lastTrade: { p: price },
    source: SOURCE.DEMO,
  };
}

function demoRef(sym) {
  return {
    ticker: sym,
    name: lookupName(sym) !== sym ? lookupName(sym) : `${sym} Demo Company`,
    market: "stocks",
    locale: "us",
    primary_exchange: (hashSymbol(sym) % 2 ? "XNAS" : "XNYS"),
    type: "CS",
    active: true,
    currency_name: "usd",
  };
}

function demoBars(sym, interval = "5m", count = 72) {
  const spec = {
    "1m": [1, "minute"], "5m": [5, "minute"], "15m": [15, "minute"],
    "30m": [30, "minute"], "1h": [1, "hour"], "1d": [1, "day"],
  }[interval] || [5, "minute"];
  const stepMs = spec[1] === "day" ? 86400000 : spec[1] === "hour" ? 3600000 : spec[0] * 60000;
  const h = hashSymbol(sym);
  const base = DEMO_BASE[sym] || (1 + (h % 30000) / 100);
  const now = Date.now();
  let price = base * (0.96 + ((h % 80) / 1000));
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = now - i * stepMs;
    const idx = count - 1 - i;
    const wave = Math.sin(idx * 0.48 + h * 0.07) * (0.006 + (h % 9) / 2600);
    const drift = (idx / count) * (((h % 17) - 6) / 900);
    const o = Math.max(0.03, price);
    const c = Math.max(0.03, o * (1 + wave + drift / count));
    const spread = 0.0025 + Math.abs(Math.sin(idx * 0.73 + h)) * 0.006;
    const hi = Math.max(o, c) * (1 + spread);
    const lo = Math.min(o, c) * (1 - spread * 0.85);
    const v = Math.round((25000 + (h % 420000)) * (0.45 + Math.abs(Math.sin(idx * 0.31 + h * 0.13)) * 2.2));
    out.push({ t, o, h: hi, l: lo, c, v, source: SOURCE.DEMO });
    price = c;
  }
  return out;
}

function normalizeRow(ref, snap, flt) {
  const ticker = (snap && snap.ticker) || (ref && ref.ticker) || "";
  const price = num(snap && (snap.lastTrade && snap.lastTrade.p != null ? snap.lastTrade.p : snap.min && snap.min.c != null ? snap.min.c : snap.day && snap.day.c));
  return {
    ticker,
    name: (ref && ref.name) || "",
    type: (ref && ref.type) || "",
    exchange: (ref && ref.primary_exchange) || "",
    price,
    changePct: num(snap && snap.todaysChangePerc),
    volume: num(snap && ((snap.day && snap.day.v) || (snap.min && snap.min.av))),
    minuteOpen: num(snap && snap.min && snap.min.o),
    minuteClose: num(snap && snap.min && snap.min.c),
    prevVolume: num(snap && snap.prevDay && snap.prevDay.v),
    float: flt && flt.free_float != null ? flt.free_float : null,
    floatPct: flt && flt.free_float_percent != null ? flt.free_float_percent : null,
    floatDate: (flt && flt.effective_date) || null,
    raw: snap || null,
    source: (snap && snap.source) || SOURCE.DEMO,
  };
}

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

class DemoMarketDataProvider {
  constructor() {
    this.id = "demo";
    this.name = "DEMO";
  }

  getStatus() {
    return {
      mode: "demo",
      provider: "DEMO",
      feed: null,
      source: SOURCE.DEMO,
      label: "DEMO DATA",
      delayLabel: "DEMO",
      live: false,
      hasApiKey: false,
      credentialsConfigured: false,
      floatAvailable: false,
      warning:
        "No Alpaca credentials configured. Every price, volume, float, and score on screen is simulated and must not be treated as market data.",
      coverage: {
        ...coverageMeta(),
        type: "demo_universe",
        fullMarket: false,
        size: DEMO_SYMBOLS.length,
        label: `DEMO — simulated sample (${DEMO_SYMBOLS.length} symbols), not the market`,
      },
      probedAt: new Date().toISOString(),
    };
  }

  async getSnapshots(symbols) {
    const tickers = (symbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean).map(demoSnapshot);
    return { status: "OK", mode: "demo", tickers };
  }

  async getBars(symbol, interval) {
    const sym = String(symbol || "").toUpperCase();
    return { status: "OK", mode: "demo", symbol: sym, interval, bars: demoBars(sym, interval) };
  }

  async getTicker(symbol) {
    const sym = String(symbol || "").toUpperCase();
    return {
      status: "OK",
      mode: "demo",
      ticker: demoSnapshot(sym),
      details: demoRef(sym),
      float: demoFloat(sym),
    };
  }

  async getMarket() {
    const rows = DEMO_SYMBOLS.map((s) => normalizeRow(demoRef(s), demoSnapshot(s), demoFloat(s)));
    return {
      rows,
      snapshotError: null,
      priceDataAvailable: true,
      coverage: this.getStatus().coverage,
    };
  }

  async getGainers() {
    const rows = DEMO_SYMBOLS.map((s) => normalizeRow(demoRef(s), demoSnapshot(s), demoFloat(s)))
      .sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
    return {
      rows: rows.slice(0, 30),
      tickers: rows.slice(0, 30).map((r) => r.raw),
      priceDataAvailable: true,
      coverage: this.getStatus().coverage,
    };
  }
}

module.exports = {
  DemoMarketDataProvider,
  demoSnapshot,
  demoBars,
  demoFloat,
  demoRef,
  DEMO_SYMBOLS,
  normalizeRow,
};
