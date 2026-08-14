"use strict";

const { SOURCE, field, naField } = require("./sources");
const { UNIVERSE, lookupName, coverageMeta } = require("./universe");
const {
  volatilityScore,
  dailyRelativeVolume,
  pctChange,
  shortTermPctFromBars,
} = require("./metrics");

const TIMEFRAME_MINUTES = {
  "1Min": 1,
  "5Min": 5,
  "15Min": 15,
  "30Min": 30,
  "1Hour": 60,
  "1Day": 390,
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSymbol(symbol) {
  const s = String(symbol || "X");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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
      credentialsConfigured: false,
      floatAvailable: false,
      warning:
        "No Alpaca credentials configured. Every price, volume, and score on screen is simulated and must not be treated as market data.",
      coverage: {
        ...coverageMeta(),
        label: `Demo universe (${UNIVERSE.length} simulated symbols)`,
      },
      probedAt: new Date().toISOString(),
    };
  }

  async getQuote(symbol) {
    return this.getSnapshot(symbol);
  }

  async getSnapshot(symbol) {
    const snap = this._snapshot(symbol);
    return snap;
  }

  async getWatchlistSnapshots(symbols) {
    return (symbols || []).map((s) => this._snapshot(s));
  }

  async getBars(symbol, timeframe) {
    const tf = timeframe || "5Min";
    const minutes = TIMEFRAME_MINUTES[tf] || 5;
    const count = tf === "1Day" ? 120 : Math.min(240, Math.floor((6.5 * 60) / minutes) * (tf === "1Min" ? 1 : 3));
    const bars = this._bars(symbol, minutes, count, tf === "1Day");
    return {
      symbol: String(symbol).toUpperCase(),
      timeframe: tf,
      source: SOURCE.DEMO,
      bars,
    };
  }

  async getMarketUniverse() {
    return {
      coverage: this.getStatus().coverage,
      symbols: UNIVERSE.map((row) => ({
        ...row,
        source: SOURCE.DEMO,
      })),
    };
  }

  async getMovers() {
    const snaps = UNIVERSE.map((row) => this._snapshot(row.symbol));
    const gainers = [...snaps].sort((a, b) => (b.changePct.value || 0) - (a.changePct.value || 0));
    const volume = [...snaps].sort((a, b) => (b.volume.value || 0) - (a.volume.value || 0));
    const volatile = [...snaps].sort(
      (a, b) => (b.volatilityScore.value || 0) - (a.volatilityScore.value || 0)
    );
    const coverage = {
      ...coverageMeta(),
      type: "demo_universe",
      fullMarket: false,
      label: `DEMO — limited simulated universe (${UNIVERSE.length} symbols)`,
    };
    return {
      coverage,
      source: SOURCE.DEMO,
      gainers: gainers.slice(0, 25),
      highVolume: volume.slice(0, 25),
      volatile: volatile.slice(0, 25),
    };
  }

  async getDetail(symbol, timeframe) {
    const snap = this._snapshot(symbol);
    const bars = await this.getBars(symbol, timeframe);
    return { ...snap, bars: bars.bars, timeframe: bars.timeframe };
  }

  _snapshot(symbol) {
    const sym = String(symbol || "").toUpperCase();
    const src = SOURCE.DEMO;
    const { last, prevClose, open, high, low, close, volume, bars } = this._sessionStats(sym);
    const changePct = pctChange(last, prevClose);
    const rvol = dailyRelativeVolume(volume, this._priorVolumes(sym));
    const shortTermPct = shortTermPctFromBars(bars, last, 30);
    const score = volatilityScore({
      last,
      prevClose,
      open,
      high,
      low,
      shortTermPct,
      rvol,
    });
    return {
      symbol: sym,
      name: lookupName(sym),
      source: src,
      last: field(last, src),
      prevClose: field(prevClose, src),
      changePct: field(changePct, src),
      open: field(open, src),
      high: field(high, src),
      low: field(low, src),
      close: field(close, src),
      volume: field(volume, src),
      rvol: field(rvol, src, {
        method: "daily_vs_adv",
        approximation:
          "Demo RVOL is simulated daily volume versus a 10-session simulated average. Not real market RVOL.",
      }),
      volatilityScore: field(score, src, {
        note: "Demo scanner metric (0–100). Not investment advice.",
      }),
      freeFloat: naField("Float data unavailable from current provider"),
      floatPct: naField("Float data unavailable from current provider"),
      sharesOutstanding: naField("Float data unavailable from current provider"),
      asOf: new Date().toISOString(),
    };
  }

  _sessionStats(symbol) {
    const bars = this._bars(symbol, 1, 390, false);
    const last = bars[bars.length - 1].c;
    const open = bars[0].o;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const b of bars) {
      high = Math.max(high, b.h);
      low = Math.min(low, b.l);
      volume += b.v;
    }
    const prevClose = this._basePrice(symbol) * 0.99;
    return { last, prevClose, open, high, low, close: last, volume, bars };
  }

  _basePrice(symbol) {
    const r = mulberry32(hashSymbol(symbol));
    return 8 + r() * 420;
  }

  _priorVolumes(symbol) {
    const r = mulberry32(hashSymbol(symbol) ^ 0x9e3779b9);
    const vols = [];
    for (let i = 0; i < 10; i++) vols.push(2e6 + r() * 4e7);
    return vols;
  }

  _bars(symbol, minutes, count, daily) {
    const r = mulberry32(hashSymbol(symbol) ^ (minutes * 997));
    const base = this._basePrice(symbol);
    const now = Date.now();
    const step = daily ? 24 * 60 * 60 * 1000 : minutes * 60 * 1000;
    const tick = Math.floor(now / (15 * 1000));
    let price = base * (1 + ((tick % 50) - 25) / 2000);
    const bars = [];
    for (let i = count - 1; i >= 0; i--) {
      const t = new Date(now - i * step).toISOString();
      const drift = (r() - 0.48) * price * (daily ? 0.03 : 0.004);
      const o = price;
      const c = Math.max(0.5, o + drift);
      const h = Math.max(o, c) * (1 + r() * 0.006);
      const l = Math.min(o, c) * (1 - r() * 0.006);
      const v = Math.round((5e4 + r() * 8e5) * Math.sqrt(minutes));
      bars.push({
        t,
        o: round(o),
        h: round(h),
        l: round(l),
        c: round(c),
        v,
        source: SOURCE.DEMO,
      });
      price = c;
    }
    return bars;
  }
}

function round(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { DemoMarketDataProvider };
