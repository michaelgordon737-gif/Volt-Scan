"use strict";

const { SOURCE, FEED_META } = require("./sources");
const { UNIVERSE, lookupName, coverageMeta } = require("./universe");
const { normalizeRow } = require("./demo-provider");

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

const FLOAT_UNAVAILABLE = {
  free_float: null,
  free_float_percent: null,
  effective_date: null,
  note: "Float data unavailable from current provider",
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
    this._assets = { at: 0, rows: [] };
  }

  async init() {
    if (!this._ready) this._ready = this._probe();
    return this._ready;
  }

  async _probe() {
    const order = uniqueFeeds([this.preferredFeed, "delayed_sip", "iex"]);
    const tried = [];
    for (const feed of order) {
      const result = await this._request("/v2/stocks/AAPL/snapshot", { feed }, { allowFail: true });
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
    const result = await this._request("/v1beta1/screener/stocks/movers", { top: 5 }, { allowFail: true });
    this.moversAvailable = Boolean(result.ok);
  }

  getStatus() {
    const meta = this.feedMeta;
    const ok = Boolean(this.feed);
    return {
      mode: "live",
      provider: "Alpaca",
      feed: this.feed,
      source: ok ? meta.source : SOURCE.UNAVAILABLE,
      label: ok ? meta.headerLabel : "ALPACA • UNAVAILABLE",
      delayLabel: ok ? meta.delayLabel : "UNAVAILABLE",
      live: ok ? Boolean(meta.live) : false,
      hasApiKey: true,
      credentialsConfigured: true,
      floatAvailable: false,
      warning: this.probeError || this.warning,
      preferredFeed: this.preferredFeed,
      moversAvailable: this.moversAvailable,
      coverage: {
        ...coverageMeta(),
        fullMarket: false,
        label: `Limited priced universe (${UNIVERSE.length} liquid U.S. symbols). Not a full-market snapshot.`,
      },
      probedAt: new Date().toISOString(),
    };
  }

  _source() {
    return (this.feedMeta && this.feedMeta.source) || SOURCE.UNAVAILABLE;
  }

  async getSnapshots(symbols) {
    await this.init();
    const wanted = uniqueSymbols(symbols);
    if (!this.feed) {
      return {
        status: "OK",
        mode: "live",
        tickers: wanted.map((s) => this._emptyMassive(s, this.probeError)),
      };
    }
    const now = Date.now();
    const out = [];
    const missing = [];
    for (const symbol of wanted) {
      const hit = this._snapCache.get(symbol);
      if (hit && now - hit.at < this._cacheMs) out.push(hit.value);
      else missing.push(symbol);
    }
    for (const batch of chunk(missing, 50)) {
      const result = await this._request("/v2/stocks/snapshots", {
        symbols: batch.join(","),
        feed: this.feed,
      });
      if (!result.ok) {
        for (const symbol of batch) out.push(this._emptyMassive(symbol, result.error || `HTTP ${result.status}`));
        continue;
      }
      const payload = result.data || {};
      const snaps = payload.snapshots || payload;
      for (const symbol of batch) {
        const raw = snaps[symbol] || snaps[symbol.replace(".", "/")] || null;
        const normalized = raw
          ? this._toMassive(symbol, raw)
          : this._emptyMassive(symbol, "Symbol not returned by Alpaca");
        this._snapCache.set(symbol, { at: Date.now(), value: normalized });
        out.push(normalized);
      }
    }
    const bySym = Object.fromEntries(out.map((s) => [s.ticker, s]));
    return {
      status: "OK",
      mode: "live",
      tickers: wanted.map((s) => bySym[s] || this._emptyMassive(s, "Missing snapshot")),
    };
  }

  async getBars(symbol, interval) {
    await this.init();
    const tf = TIMEFRAME_MAP[interval] || "5Min";
    const src = this._source();
    if (!this.feed) {
      return { status: "OK", mode: "live", symbol: up(symbol), interval, bars: [], error: this.probeError };
    }
    const look = BAR_LOOKBACK[tf] || BAR_LOOKBACK["5Min"];
    const end = this._historicalEnd();
    const start = new Date(end.getTime() - look.days * 24 * 60 * 60 * 1000);
    let bars;
    try {
      bars = await this._fetchBars(up(symbol), tf, start, end, look.limit);
    } catch (err) {
      if (tf !== "1Min") {
        const minute = await this._fetchBars(up(symbol), "1Min", start, end, 10000);
        bars = aggregateBars(minute, tf);
      } else {
        throw err;
      }
    }
    return {
      status: "OK",
      mode: "live",
      symbol: up(symbol),
      interval,
      bars: (bars || []).slice(-120).map((b) => ({
        t: typeof b.t === "number" ? b.t : Date.parse(b.t),
        o: num(b.o),
        h: num(b.h),
        l: num(b.l),
        c: num(b.c),
        v: num(b.v),
        source: src,
      })).filter((b) => Number.isFinite(b.t) && b.o != null && b.h != null && b.l != null && b.c != null),
    };
  }

  async getTicker(symbol) {
    const pack = await this.getSnapshots([symbol]);
    const ticker = pack.tickers[0] || this._emptyMassive(symbol, "No snapshot");
    const details = await this._assetDetails(symbol);
    return {
      status: "OK",
      mode: "live",
      ticker,
      details,
      float: FLOAT_UNAVAILABLE,
    };
  }

  async getReferenceUniverse() {
    const assets = await this._getAssets();
    if (assets.length) return assets;
    return UNIVERSE.map((row) => ({
      ticker: row.symbol,
      name: row.name,
      type: "CS",
      primary_exchange: "",
      market: "stocks",
      locale: "us",
      active: true,
      currency_name: "usd",
    }));
  }

  async getMarket() {
    await this.init();
    const refs = await this.getReferenceUniverse();
    const pricedSymbols = uniqueSymbols([
      ...UNIVERSE.map((r) => r.symbol),
      ...refs.slice(0, 0),
    ]);
    const { tickers } = await this.getSnapshots(pricedSymbols);
    const snapMap = new Map(tickers.map((t) => [t.ticker, t]));
    const rows = refs.map((ref) => normalizeRow(ref, snapMap.get(ref.ticker) || null, null));
    const priced = tickers.filter((t) => t.lastTrade && t.lastTrade.p != null).length;
    return {
      rows,
      snapshotError: this.probeError,
      priceDataAvailable: priced > 0,
      coverage: {
        ...coverageMeta(),
        fullMarket: false,
        type: refs.length > UNIVERSE.length ? "asset_catalog_plus_limited_prices" : "limited_provider_universe",
        catalogSize: refs.length,
        pricedSize: priced,
        label: refs.length > UNIVERSE.length
          ? `Alpaca asset catalog (${refs.length} symbols). Live/delayed prices attached for a limited liquid universe (${UNIVERSE.length}), not every listing.`
          : `Limited priced universe (${UNIVERSE.length} liquid U.S. symbols). Not the full U.S. market.`,
      },
    };
  }

  async getGainers() {
    await this.init();
    if (!this.feed) {
      return {
        rows: [],
        tickers: [],
        priceDataAvailable: false,
        error: this.probeError,
        coverage: this.getStatus().coverage,
      };
    }
    let screener = [];
    if (this.moversAvailable !== false) {
      const movers = await this._request("/v1beta1/screener/stocks/movers", { top: 20 }, { allowFail: true });
      this.moversAvailable = Boolean(movers.ok);
      if (movers.ok && Array.isArray(movers.data && movers.data.gainers)) {
        screener = movers.data.gainers.map((g) => g.symbol).filter(Boolean);
      }
    }
    const symbols = uniqueSymbols([...screener, ...UNIVERSE.map((r) => r.symbol)]);
    const { tickers } = await this.getSnapshots(symbols);
    const usable = tickers.filter((t) => t.lastTrade && t.lastTrade.p != null && t.todaysChangePerc != null);
    const ordered = screener.length
      ? screener.map((sym) => usable.find((t) => t.ticker === sym)).filter(Boolean)
      : [...usable].sort((a, b) => (b.todaysChangePerc || -Infinity) - (a.todaysChangePerc || -Infinity));
    const top = ordered.slice(0, 100);
    const refs = Object.fromEntries((await this.getReferenceUniverse()).map((r) => [r.ticker, r]));
    const rows = top.map((snap) => normalizeRow(refs[snap.ticker] || { ticker: snap.ticker, name: lookupName(snap.ticker), type: "CS" }, snap, null));
    return {
      rows,
      tickers: top,
      priceDataAvailable: top.length > 0,
      coverage: {
        ...coverageMeta(),
        fullMarket: false,
        moversScreener: Boolean(screener.length),
        label: screener.length
          ? `Alpaca movers screener + limited universe. Not guaranteed full-market coverage.`
          : `Top gainers inside VoltScan limited universe (${UNIVERSE.length} symbols). Not the full U.S. market.`,
      },
    };
  }

  _toMassive(symbol, raw) {
    const trade = raw.latestTrade || raw.LatestTrade || null;
    const daily = raw.dailyBar || raw.DailyBar || null;
    const prev = raw.prevDailyBar || raw.PrevDailyBar || null;
    const minute = raw.minuteBar || raw.MinuteBar || null;
    const last = num(trade && trade.p) ?? num(minute && minute.c) ?? num(daily && daily.c);
    const prevClose = num(prev && prev.c);
    const change = last != null && prevClose != null ? last - prevClose : null;
    const changePct = last != null && prevClose ? ((last - prevClose) / prevClose) * 100 : null;
    const ts = trade && trade.t ? Date.parse(trade.t) : Date.now();
    return {
      ticker: up(symbol),
      todaysChangePerc: changePct,
      todaysChange: change,
      updated: Number.isFinite(ts) ? ts * 1_000_000 : Date.now() * 1_000_000,
      day: {
        o: num(daily && daily.o),
        h: num(daily && daily.h),
        l: num(daily && daily.l),
        c: num(daily && daily.c) ?? last,
        v: num(daily && daily.v),
      },
      prevDay: { c: prevClose, v: num(prev && prev.v) },
      min: {
        o: num(minute && minute.o),
        h: num(minute && minute.h),
        l: num(minute && minute.l),
        c: num(minute && minute.c) ?? last,
        v: num(minute && minute.v),
        av: num(daily && daily.v),
      },
      lastTrade: { p: last, t: trade && trade.t },
      source: this._source(),
    };
  }

  _emptyMassive(symbol, note) {
    return {
      ticker: up(symbol),
      todaysChangePerc: null,
      todaysChange: null,
      updated: null,
      day: { o: null, h: null, l: null, c: null, v: null },
      prevDay: { c: null, v: null },
      min: { o: null, h: null, l: null, c: null, v: null, av: null },
      lastTrade: { p: null },
      source: SOURCE.UNAVAILABLE,
      error: note || null,
    };
  }

  async _assetDetails(symbol) {
    const refs = await this.getReferenceUniverse();
    const hit = refs.find((r) => r.ticker === up(symbol));
    if (hit) return hit;
    return {
      ticker: up(symbol),
      name: lookupName(symbol),
      type: "CS",
      primary_exchange: "",
      market: "stocks",
      locale: "us",
      active: true,
      currency_name: "usd",
    };
  }

  async _getAssets() {
    if (Date.now() - this._assets.at < 12 * 60 * 60 * 1000 && this._assets.rows.length) {
      return this._assets.rows;
    }
    for (const host of TRADE_HOSTS) {
      try {
        const url = `${host}/v2/assets?status=active&asset_class=us_equity`;
        const res = await fetch(url, {
          headers: {
            "APCA-API-KEY-ID": this.apiKey,
            "APCA-API-SECRET-KEY": this.secretKey,
            accept: "application/json",
          },
        });
        if (!res.ok) continue;
        const data = await res.json();
        const rows = (Array.isArray(data) ? data : [])
          .filter((a) => a && a.tradable && a.status === "active")
          .map((a) => ({
            ticker: up(a.symbol),
            name: a.name || a.symbol,
            type: "CS",
            primary_exchange: a.exchange || "",
            market: "stocks",
            locale: "us",
            active: true,
            currency_name: "usd",
          }));
        if (rows.length) {
          this._assets = { at: Date.now(), rows };
          return rows;
        }
      } catch {
        /* try next host */
      }
    }
    return [];
  }

  _historicalEnd() {
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
      if (!result.ok) throw new Error(result.error || `Bars HTTP ${result.status}`);
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
          const msg = (data && (data.message || data.error)) || text || `HTTP ${res.status}`;
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
      });
    } else {
      g.h = Math.max(g.h, bar.h);
      g.l = Math.min(g.l, bar.l);
      g.c = bar.c;
      g.v += bar.v || 0;
    }
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function uniqueFeeds(list) {
  const out = [];
  for (const f of list) if (f && !out.includes(f)) out.push(f);
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
