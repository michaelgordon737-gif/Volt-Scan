"use strict";

const { SOURCE, FEED_META, field, naField } = require("./sources");
const { UNIVERSE, lookupName, coverageMeta } = require("./universe");
const {
  volatilityScore,
  dailyRelativeVolume,
  pctChange,
  sessionComparableRvol,
  shortTermPctFromBars,
} = require("./metrics");

const DATA_HOST = "https://data.alpaca.markets";
const TRADE_HOSTS = [
  "https://paper-api.alpaca.markets",
  "https://api.alpaca.markets",
];

const TIMEFRAME_MAP = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "30m": "30Min",
  "1h": "1Hour",
  "1d": "1Day",
  "1Min": "1Min",
  "5Min": "5Min",
  "15Min": "15Min",
  "30Min": "30Min",
  "1Hour": "1Hour",
  "1Day": "1Day",
};

const BAR_LOOKBACK = {
  "1Min": { days: 2, limit: 2000 },
  "5Min": { days: 5, limit: 2000 },
  "15Min": { days: 10, limit: 2000 },
  "30Min": { days: 15, limit: 2000 },
  "1Hour": { days: 30, limit: 2000 },
  "1Day": { days: 260, limit: 300 },
};

class AlpacaMarketDataProvider {
  constructor({ apiKey, secretKey, preferredFeed = "delayed_sip" }) {
    this.id = "alpaca";
    this.name = "ALPACA";
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.preferredFeed = preferredFeed || "delayed_sip";
    this.feed = null;
    this.feedMeta = null;
    this.warning = null;
    this.probeError = null;
    this.moversAvailable = null;
    this._ready = null;
    this._snapCache = new Map();
    this._cacheMs = 20_000;
  }

  async init() {
    if (!this._ready) this._ready = this._probe();
    return this._ready;
  }

  async _probe() {
    const order = uniqueFeeds([this.preferredFeed, "delayed_sip", "iex"]);
    const tried = [];
    for (const feed of order) {
      const result = await this._request(
        `/v2/stocks/AAPL/snapshot`,
        { feed },
        { allowFail: true }
      );
      tried.push({ feed, status: result.status, error: result.error || null });
      if (result.ok) {
        this.feed = feed;
        this.feedMeta = FEED_META[feed] || FEED_META.delayed_sip;
        if (feed !== this.preferredFeed) {
          this.warning = `${this.preferredFeed} is not available on this Alpaca entitlement. Using ${feed} instead. ${
            (FEED_META[feed] && FEED_META[feed].coverageNote) || ""
          }`.trim();
        } else if (FEED_META[feed] && FEED_META[feed].coverageNote) {
          this.warning = FEED_META[feed].coverageNote;
        }
        await this._probeMovers();
        return this.getStatus();
      }
      if (result.status === 401) {
        this.probeError = "Alpaca authentication failed. Check ALPACA_API_KEY and ALPACA_SECRET_KEY.";
        break;
      }
    }
    this.probeError =
      this.probeError ||
      `Could not open an Alpaca market-data feed. Tried: ${tried
        .map((t) => `${t.feed} (${t.status || t.error})`)
        .join(", ")}`;
    this.feed = null;
    this.feedMeta = null;
    return this.getStatus();
  }

  async _probeMovers() {
    const result = await this._request(
      `/v1beta1/screener/stocks/movers`,
      { top: 5 },
      { allowFail: true }
    );
    this.moversAvailable = Boolean(result.ok);
  }

  getStatus() {
    const meta = this.feedMeta;
    const ok = Boolean(this.feed);
    return {
      mode: ok ? "alpaca" : "alpaca_unavailable",
      provider: "ALPACA",
      feed: this.feed,
      source: ok ? meta.source : SOURCE.UNAVAILABLE,
      label: ok ? meta.headerLabel : "ALPACA • UNAVAILABLE",
      delayLabel: ok ? meta.delayLabel : "UNAVAILABLE",
      live: ok ? Boolean(meta.live) : false,
      credentialsConfigured: true,
      floatAvailable: false,
      warning: this.probeError || this.warning,
      preferredFeed: this.preferredFeed,
      moversAvailable: this.moversAvailable,
      coverage: coverageMeta(),
      probedAt: new Date().toISOString(),
    };
  }

  _source() {
    return (this.feedMeta && this.feedMeta.source) || SOURCE.UNAVAILABLE;
  }

  async getQuote(symbol) {
    return this.getSnapshot(symbol);
  }

  async getSnapshot(symbol) {
    const map = await this.getWatchlistSnapshots([symbol]);
    return map[0] || this._emptySnapshot(symbol, "No snapshot returned");
  }

  async getWatchlistSnapshots(symbols) {
    await this.init();
    const src = this._source();
    const wanted = uniqueSymbols(symbols);
    if (!this.feed) {
      return wanted.map((s) => this._emptySnapshot(s, this.probeError));
    }
    const fresh = [];
    const missing = [];
    const now = Date.now();
    for (const symbol of wanted) {
      const hit = this._snapCache.get(symbol);
      if (hit && now - hit.at < this._cacheMs) fresh.push(hit.value);
      else missing.push(symbol);
    }
    for (const batch of chunk(missing, 50)) {
      const result = await this._request("/v2/stocks/snapshots", {
        symbols: batch.join(","),
        feed: this.feed,
      });
      if (!result.ok) {
        for (const symbol of batch) {
          fresh.push(this._emptySnapshot(symbol, result.error || `HTTP ${result.status}`));
        }
        continue;
      }
      const payload = result.data || {};
      const snaps = payload.snapshots || payload;
      for (const symbol of batch) {
        const raw = snaps[symbol] || snaps[symbol.replace(".", "/")] || null;
        const normalized = raw
          ? this._normalizeSnapshot(symbol, raw, src)
          : this._emptySnapshot(symbol, "Symbol not returned by Alpaca");
        this._snapCache.set(symbol, { at: Date.now(), value: normalized });
        fresh.push(normalized);
      }
    }
    const bySym = Object.fromEntries(fresh.map((s) => [s.symbol, s]));
    return wanted.map((s) => bySym[s] || this._emptySnapshot(s, "Missing snapshot"));
  }

  async getBars(symbol, timeframe, from, to) {
    await this.init();
    const tf = TIMEFRAME_MAP[timeframe] || timeframe || "5Min";
    const src = this._source();
    if (!this.feed) {
      return { symbol: up(symbol), timeframe: tf, source: SOURCE.UNAVAILABLE, bars: [], error: this.probeError };
    }
    const look = BAR_LOOKBACK[tf] || BAR_LOOKBACK["5Min"];
    const end = to ? new Date(to) : this._historicalEnd();
    const start = from ? new Date(from) : new Date(end.getTime() - look.days * 24 * 60 * 60 * 1000);
    let bars;
    let usedTimeframe = tf;
    try {
      bars = await this._fetchBars(up(symbol), tf, start, end, look.limit);
    } catch (err) {
      if (tf !== "1Min" && /timeframe|invalid|403|400/i.test(String(err.message))) {
        const minute = await this._fetchBars(up(symbol), "1Min", start, end, 10000);
        bars = aggregateBars(minute, tf);
        usedTimeframe = tf;
      } else {
        throw err;
      }
    }
    return {
      symbol: up(symbol),
      timeframe: usedTimeframe,
      source: src,
      bars: (bars || []).map((b) => ({
        t: b.t,
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        v: b.v,
        n: b.n,
        vw: b.vw,
        source: src,
      })),
    };
  }

  async getMarketUniverse() {
    return {
      coverage: coverageMeta(),
      symbols: UNIVERSE.map((row) => ({ ...row, source: this._source() })),
    };
  }

  async getMovers() {
    await this.init();
    const coverage = coverageMeta();
    if (!this.feed) {
      return {
        coverage,
        source: SOURCE.UNAVAILABLE,
        gainers: [],
        highVolume: [],
        volatile: [],
        error: this.probeError,
      };
    }

    let screenerGainers = null;
    let screenerVolume = null;
    if (this.moversAvailable !== false) {
      const movers = await this._request(
        `/v1beta1/screener/stocks/movers`,
        { top: 20 },
        { allowFail: true }
      );
      const actives = await this._request(
        `/v1beta1/screener/stocks/most-actives`,
        { by: "volume", top: 20 },
        { allowFail: true }
      );
      this.moversAvailable = Boolean(movers.ok);
      if (movers.ok && Array.isArray(movers.data && movers.data.gainers)) {
        screenerGainers = movers.data.gainers.map((g) => g.symbol).filter(Boolean);
      }
      if (actives.ok && Array.isArray(actives.data && actives.data.most_actives)) {
        screenerVolume = actives.data.most_actives.map((g) => g.symbol).filter(Boolean);
      }
    }

    const watchExtra = [];
    const universeSymbols = uniqueSymbols([
      ...UNIVERSE.map((r) => r.symbol),
      ...(screenerGainers || []),
      ...(screenerVolume || []),
      ...watchExtra,
    ]);
    const snaps = await this.getWatchlistSnapshots(universeSymbols);
    const usable = snaps.filter((s) => s.last.value != null);

    const byPct = [...usable].sort((a, b) => (b.changePct.value || -Infinity) - (a.changePct.value || -Infinity));
    const byVol = [...usable].sort((a, b) => (b.volume.value || 0) - (a.volume.value || 0));
    const byScore = [...usable].sort(
      (a, b) => (b.volatilityScore.value || 0) - (a.volatilityScore.value || 0)
    );

    const coverageOut = {
      ...coverage,
      type: screenerGainers ? "provider_screener_plus_limited_universe" : "limited_provider_universe",
      fullMarket: false,
      label: screenerGainers
        ? `Alpaca movers screener + limited universe (${universeSymbols.length} symbols). Not the full U.S. market.`
        : `Limited universe (${UNIVERSE.length} liquid U.S. symbols). Not the full U.S. market.`,
      moversScreener: Boolean(screenerGainers),
    };

    return {
      coverage: coverageOut,
      source: this._source(),
      gainers: (screenerGainers
        ? screenerGainers.map((sym) => usable.find((s) => s.symbol === sym)).filter(Boolean)
        : byPct
      ).slice(0, 25),
      highVolume: (screenerVolume
        ? screenerVolume.map((sym) => usable.find((s) => s.symbol === sym)).filter(Boolean)
        : byVol
      ).slice(0, 25),
      volatile: byScore.slice(0, 25),
    };
  }

  async getDetail(symbol, timeframe) {
    await this.init();
    const src = this._source();
    const [snap, barsPack, metricsPack] = await Promise.all([
      this.getSnapshot(symbol),
      this.getBars(symbol, timeframe || "5Min"),
      this._computeMetrics(symbol),
    ]);
    const rvolField = metricsPack.rvol != null
      ? field(metricsPack.rvol, src, {
          method: metricsPack.rvolMethod,
          approximation: metricsPack.rvolNote,
          elapsedMinutes: metricsPack.elapsedMinutes,
          priorCount: metricsPack.priorCount,
        })
      : naField(metricsPack.rvolNote || "Relative volume unavailable");
    const score = volatilityScore({
      last: snap.last.value,
      prevClose: snap.prevClose.value,
      open: snap.open.value,
      high: snap.high.value,
      low: snap.low.value,
      shortTermPct: metricsPack.shortTermPct,
      rvol: rvolField.value,
    });
    return {
      ...snap,
      rvol: rvolField,
      volatilityScore:
        score == null
          ? naField("Not enough market data to score")
          : field(score, src, {
              note: "Deterministic 0–100 scanner blend of daily move, 30-minute move, RVOL, and intraday range. Not investment advice.",
            }),
      bars: barsPack.bars,
      timeframe: barsPack.timeframe,
      barsSource: barsPack.source,
    };
  }

  async _computeMetrics(symbol) {
    if (!this.feed) {
      return { rvol: null, rvolMethod: null, rvolNote: this.probeError, shortTermPct: null };
    }
    const end = this._historicalEnd();
    const start = new Date(end.getTime() - 18 * 24 * 60 * 60 * 1000);
    let minuteBars = [];
    try {
      minuteBars = await this._fetchBars(up(symbol), "1Min", start, end, 10000);
    } catch (err) {
      return {
        rvol: null,
        rvolMethod: null,
        rvolNote: `Minute bars unavailable for RVOL (${err.message})`,
        shortTermPct: null,
      };
    }
    const session = sessionComparableRvol(minuteBars, new Date());
    let rvol = session.rvol;
    let method = session.method;
    let note =
      "Approximate session-comparable RVOL: today's cumulative regular-session volume versus the average cumulative volume at the same elapsed time over the prior 10 sessions. Not institutional RVOL.";
    if (rvol == null) {
      const dailyEnd = this._historicalEnd();
      const dailyStart = new Date(dailyEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
      try {
        const daily = await this._fetchBars(up(symbol), "1Day", dailyStart, dailyEnd, 30);
        const todayVol = daily.length ? daily[daily.length - 1].v : null;
        const prior = daily.slice(0, -1).map((b) => b.v);
        rvol = dailyRelativeVolume(todayVol, prior);
        method = "daily_vs_adv";
        note =
          "Approximate RVOL: current daily volume versus average daily volume of prior sessions (ADV). Session-comparable minute RVOL was unavailable. Not institutional RVOL.";
      } catch {
        note = "Relative volume unavailable";
      }
    }
    const last = minuteBars.length ? minuteBars[minuteBars.length - 1].c : null;
    return {
      rvol,
      rvolMethod: method,
      rvolNote: note,
      elapsedMinutes: session.elapsedMinutes,
      priorCount: session.priorCount,
      shortTermPct: shortTermPctFromBars(minuteBars, last, 30),
    };
  }

  _normalizeSnapshot(symbol, raw, src) {
    const trade = raw.latestTrade || raw.LatestTrade || null;
    const daily = raw.dailyBar || raw.DailyBar || null;
    const prev = raw.prevDailyBar || raw.PrevDailyBar || null;
    const minute = raw.minuteBar || raw.MinuteBar || null;
    const last =
      num(trade && trade.p) ??
      num(minute && minute.c) ??
      num(daily && daily.c);
    const prevClose = num(prev && prev.c);
    const open = num(daily && daily.o);
    const high = num(daily && daily.h);
    const low = num(daily && daily.l);
    const close = num(daily && daily.c) ?? last;
    const volume = num(daily && daily.v);
    const changePct = pctChange(last, prevClose);
    const rvol = null;
    const score = volatilityScore({
      last,
      prevClose,
      open,
      high,
      low,
      shortTermPct: null,
      rvol: null,
    });
    return {
      symbol: up(symbol),
      name: lookupName(symbol),
      source: src,
      last: field(last, src),
      prevClose: field(prevClose, src),
      changePct: field(changePct, src),
      open: field(open, src),
      high: field(high, src),
      low: field(low, src),
      close: field(close, src),
      volume: field(volume, src),
      rvol: naField("Open the stock for session-comparable RVOL"),
      volatilityScore:
        score == null
          ? naField("Not enough data to score")
          : field(score, src, { note: "Partial score from daily range/move until detail RVOL loads." }),
      freeFloat: naField("Float data unavailable from current provider"),
      floatPct: naField("Float data unavailable from current provider"),
      sharesOutstanding: naField("Float data unavailable from current provider"),
      asOf: (trade && trade.t) || (minute && minute.t) || (daily && daily.t) || new Date().toISOString(),
    };
  }

  _emptySnapshot(symbol, note) {
    return {
      symbol: up(symbol),
      name: lookupName(symbol),
      source: SOURCE.UNAVAILABLE,
      last: naField(note),
      prevClose: naField(note),
      changePct: naField(note),
      open: naField(note),
      high: naField(note),
      low: naField(note),
      close: naField(note),
      volume: naField(note),
      rvol: naField(note),
      volatilityScore: naField(note),
      freeFloat: naField("Float data unavailable from current provider"),
      floatPct: naField("Float data unavailable from current provider"),
      sharesOutstanding: naField("Float data unavailable from current provider"),
      asOf: null,
      error: note || null,
    };
  }

  _historicalEnd() {
    // Basic plans cannot request SIP history through the last 15 minutes.
    if (this.feed === "iex") return new Date();
    return new Date(Date.now() - 16 * 60 * 1000);
  }

  async _fetchBars(symbol, timeframe, start, end, limit) {
    const bars = [];
    let pageToken = null;
    for (let i = 0; i < 8; i++) {
      const params = {
        timeframe,
        start: start.toISOString(),
        end: end.toISOString(),
        limit: Math.min(limit || 1000, 10000),
        adjustment: "split",
        feed: this.feed === "delayed_sip" ? "sip" : this.feed,
        sort: "asc",
      };
      if (pageToken) params.page_token = pageToken;
      const result = await this._request(`/v2/stocks/${encodeURIComponent(symbol)}/bars`, params);
      if (!result.ok) {
        throw new Error(result.error || `Bars HTTP ${result.status}`);
      }
      const chunkBars = (result.data && (result.data.bars || result.data.Bars)) || [];
      bars.push(...chunkBars);
      pageToken = result.data && result.data.next_page_token;
      if (!pageToken) break;
    }
    return bars;
  }

  async _request(path, params = {}, { allowFail = false } = {}) {
    const url = new URL(path, DATA_HOST);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "APCA-API-KEY-ID": this.apiKey,
            "APCA-API-SECRET-KEY": this.secretKey,
            accept: "application/json",
          },
        });
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text };
        }
        if (res.status === 429) {
          const wait = Number(res.headers.get("x-ratelimit-reset")) * 1000 - Date.now();
          await sleep(Math.max(500, Math.min(wait || 1000, 5000)));
          last = { ok: false, status: 429, error: "rate limited", data };
          continue;
        }
        if (!res.ok) {
          const msg =
            (data && (data.message || data.error)) ||
            text ||
            `HTTP ${res.status}`;
          return { ok: false, status: res.status, error: String(msg).slice(0, 400), data };
        }
        return { ok: true, status: res.status, data };
      } catch (err) {
        last = { ok: false, status: 0, error: err.message };
        await sleep(250 * (attempt + 1));
      }
    }
    if (allowFail) return last || { ok: false, status: 0, error: "request failed" };
    return last || { ok: false, status: 0, error: "request failed" };
  }
}

function aggregateBars(minuteBars, timeframe) {
  const minutes =
    timeframe === "5Min" ? 5 :
    timeframe === "15Min" ? 15 :
    timeframe === "30Min" ? 30 :
    timeframe === "1Hour" ? 60 :
    1;
  if (minutes <= 1) return minuteBars;
  const groups = new Map();
  for (const bar of minuteBars || []) {
    const ts = Date.parse(bar.t);
    if (!Number.isFinite(ts)) continue;
    const bucket = Math.floor(ts / (minutes * 60 * 1000)) * minutes * 60 * 1000;
    const g = groups.get(bucket);
    if (!g) {
      groups.set(bucket, {
        t: new Date(bucket).toISOString(),
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: bar.v || 0,
        n: bar.n || 0,
      });
    } else {
      g.h = Math.max(g.h, bar.h);
      g.l = Math.min(g.l, bar.l);
      g.c = bar.c;
      g.v += bar.v || 0;
      g.n += bar.n || 0;
    }
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function uniqueFeeds(list) {
  const out = [];
  for (const f of list) {
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

function uniqueSymbols(list) {
  const out = [];
  const seen = new Set();
  for (const s of list || []) {
    const v = up(s);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function up(s) {
  return String(s || "").trim().toUpperCase();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  AlpacaMarketDataProvider,
  TIMEFRAME_MAP,
  aggregateBars,
  TRADE_HOSTS,
};
