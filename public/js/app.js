"use strict";

const ASSET_V = "3";
const WATCH_KEY = "voltscan.watchlist";
const ALERT_KEY = "voltscan.alerts";
const HISTORY_KEY = "voltscan.alertHistory";
const DEFAULT_WATCH = ["AAPL", "TSLA", "NVDA", "AMD", "MSFT"];
const INTERVALS = [
  { id: "1Min", label: "1m" },
  { id: "5Min", label: "5m" },
  { id: "15Min", label: "15m" },
  { id: "30Min", label: "30m" },
  { id: "1Hour", label: "1h" },
  { id: "1Day", label: "1d" },
];

const INFO = {
  freeFloat:
    "Free float is the number of shares available for public trading (not closely held). Alpaca does not provide free-float data, so VoltScan shows N/A until another fundamentals provider is added. This is not estimated.",
  floatPct:
    "Float % is free float divided by shares outstanding. Without a fundamentals provider this stays N/A. Float data unavailable from current provider.",
  volatilityScore:
    "VoltScan Volatility Score is a 0–100 scanner metric, not a buy/sell signal and not investment advice. It blends absolute daily % move, a ~30-minute short-term move, relative-volume pace, and intraday range. Missing pieces are skipped. Same inputs always produce the same score.",
  rvol:
    "Relative Volume compares current volume to a typical pace. VoltScan uses an approximate session-comparable formula: today's cumulative regular-session volume versus the average cumulative volume at the same elapsed time over the prior 10 sessions. If minute bars are missing, it falls back to daily volume vs average daily volume. This is not exact institutional RVOL. On IEX, volume is only a slice of the tape.",
};

const state = {
  route: "home",
  symbol: null,
  status: null,
  watchlist: loadWatchlist(),
  alerts: loadAlerts(),
  history: loadHistory(),
  snapshots: {},
  scanner: null,
  universe: [],
  detail: null,
  chartType: "candle",
  timeframe: "5Min",
  hover: null,
  search: "",
  lastError: null,
};

const view = document.getElementById("view");
const banner = document.getElementById("banner");
const statusEl = document.getElementById("data-status");
const modal = document.getElementById("modal");

function loadWatchlist() {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_KEY) || "null");
    if (Array.isArray(raw) && raw.length) {
      return [...new Set(raw.map((s) => String(s).toUpperCase()))];
    }
  } catch {}
  return DEFAULT_WATCH.slice();
}

function saveWatchlist() {
  localStorage.setItem(WATCH_KEY, JSON.stringify(state.watchlist));
}

function loadAlerts() {
  try {
    return JSON.parse(localStorage.getItem(ALERT_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveAlerts() {
  localStorage.setItem(ALERT_KEY, JSON.stringify(state.alerts));
}

function loadHistory() {
  try {
    const rows = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 80)));
}

function defaultAlert(symbol) {
  return {
    symbol,
    enabled: false,
    dailyMovePct: 5,
    shortTermMovePct: 2,
    rvol: 2,
    volScore: 70,
  };
}

/** Kept so detail render never crashes on missing helper (prior dead-click bug). */
function ruleSummary(rule) {
  if (!rule) return "No alert rules";
  const bits = [];
  if (rule.enabled === false) bits.push("paused");
  if (rule.dailyMovePct != null) bits.push(`daily ${rule.dailyMovePct}%`);
  if (rule.shortTermMovePct != null) bits.push(`short ${rule.shortTermMovePct}%`);
  if (rule.rvol != null) bits.push(`RVOL ${rule.rvol}x`);
  if (rule.volScore != null) bits.push(`score ${rule.volScore}`);
  return bits.length ? bits.join(" · ") : "No alert rules";
}

function parseRoute() {
  const hash = (location.hash || "#/home").replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean);
  const page = parts[0] || "home";
  if (page === "stock" && parts[1]) {
    state.route = "stock";
    state.symbol = parts[1].toUpperCase();
    return;
  }
  if (page === "alerts" && parts[1] === "history") {
    state.route = "history";
    state.symbol = null;
    return;
  }
  state.route = ["home", "watchlist", "gainers", "market", "alerts", "history"].includes(page)
    ? page
    : "home";
  state.symbol = null;
}

function go(path) {
  location.hash = path.startsWith("#") ? path : `#${path}`;
}

function landTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
  const dest = document.getElementById("page-anchor");
  if (dest && dest.scrollIntoView) dest.scrollIntoView({ block: "start" });
}

async function api(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function fmtNum(n, digits) {
  if (n == null || !Number.isFinite(Number(n))) return "N/A";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits ?? 2 });
}

function fmtPrice(n) {
  if (n == null || !Number.isFinite(Number(n))) return "N/A";
  const v = Number(n);
  const digits = v >= 100 ? 2 : v >= 1 ? 2 : 4;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return "N/A";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtVol(n) {
  if (n == null || !Number.isFinite(Number(n))) return "N/A";
  const v = Number(n);
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

function val(field) {
  if (field && typeof field === "object" && "value" in field) return field.value;
  return field == null ? null : field;
}

function srcLabel(field, fallback) {
  const source = (field && field.source) || (state.status && state.status.delayLabel) || fallback || "UNAVAILABLE";
  if (source === "ALPACA_DELAYED_SIP") return "15 MIN DELAYED";
  if (source === "ALPACA_IEX") return "IEX REAL-TIME";
  if (source === "ALPACA_SIP") return "SIP REAL-TIME";
  if (source === "DEMO") return "DEMO";
  if (source === "STALE") return "STALE";
  if (source === "UNAVAILABLE") return "UNAVAILABLE";
  return String(source);
}

function chgClass(n) {
  if (n == null || !Number.isFinite(Number(n))) return "na";
  if (Number(n) > 0) return "up";
  if (Number(n) < 0) return "down";
  return "na";
}

function setStatusPill() {
  const s = state.status;
  if (!s) {
    statusEl.textContent = "CONNECTING";
    statusEl.className = "status-pill unavailable";
    return;
  }
  statusEl.textContent = s.label || "UNAVAILABLE";
  statusEl.className = "status-pill";
  if (s.mode === "demo") statusEl.classList.add("demo");
  else if (s.feed === "delayed_sip") statusEl.classList.add("delayed");
  else if (s.feed === "iex" || s.feed === "sip") statusEl.classList.add("iex");
  else statusEl.classList.add("unavailable");
  if (s.warning) {
    banner.textContent = s.warning;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

function stockRow(snap, extra = "") {
  const symbol = snap.symbol || extra;
  const last = val(snap.last);
  const pct = val(snap.changePct);
  const name = snap.name || symbol;
  return `<button type="button" class="stock-row" data-open-symbol="${esc(symbol)}">
    <div>
      <div class="sym">${esc(symbol)}</div>
      <div class="name">${esc(name)}</div>
    </div>
    <div>
      <div class="px">${fmtPrice(last)}</div>
      <div class="chg ${chgClass(pct)}">${fmtPct(pct)}</div>
    </div>
  </button>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function render() {
  try {
    setStatusPill();
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.nav === visibleNav());
    });
    if (state.route === "stock") renderDetail();
    else if (state.route === "watchlist") renderWatchlist();
    else if (state.route === "gainers") renderGainers();
    else if (state.route === "market") renderMarket();
    else if (state.route === "alerts") renderAlerts();
    else if (state.route === "history") renderHistory();
    else renderHome();
  } catch (err) {
    console.error("render failed", err);
    view.innerHTML = `<div id="page-anchor" class="error">Could not render this screen. ${esc(err.message)}</div>`;
  }
}

function visibleNav() {
  if (state.route === "stock") return "watchlist";
  if (state.route === "alerts" || state.route === "history") return "home";
  return state.route;
}

function nowChip() {
  const s = state.status;
  const label = s ? s.delayLabel : "…";
  return `<div class="now-chip"><span class="dot"></span>Now: ${esc(label)}</div>`;
}

function renderHome() {
  const snaps = state.watchlist.map((s) => state.snapshots[s]).filter(Boolean);
  const gainers = ((state.scanner && state.scanner.gainers) || []).slice(0, 5);
  view.innerHTML = `
    <div id="page-anchor">
      ${nowChip()}
      <h1 class="h1">Scan</h1>
      <p class="lede">Watch unusual volume and volatility. Numbers are ${esc(
        (state.status && state.status.delayLabel) || "unverified"
      )}. This is a monitor, not a broker.</p>
      <div class="coverage">${esc((state.status && state.status.coverage && state.status.coverage.description) || "")}</div>
      <div class="row-actions">
        <button class="btn" data-nav-link="alerts" type="button">Alert settings</button>
        <button class="btn" data-nav-link="history" type="button">Alert history</button>
      </div>
      <div class="section-title"><span>Watchlist</span><button type="button" data-nav-link="watchlist">See all</button></div>
      ${snaps.length ? snaps.map(stockRow).join("") : `<div class="empty">Watchlist is empty.</div>`}
      <div class="section-title"><span>Top gainers</span><button type="button" data-nav-link="gainers">See all</button></div>
      <div class="tiny">${esc((state.scanner && state.scanner.coverage && state.scanner.coverage.label) || "Coverage unknown")}</div>
      ${gainers.length ? gainers.map(stockRow).join("") : `<div class="empty">No gainer data yet.</div>`}
    </div>`;
}

function renderWatchlist() {
  const snaps = state.watchlist.map((s) => state.snapshots[s] || { symbol: s, name: s });
  view.innerHTML = `
    <div id="page-anchor">
      <h1 class="h1">Watchlist</h1>
      <p class="lede">Stored on this phone. Tap a row to open the stock.</p>
      ${snaps.length ? snaps.map(stockRow).join("") : `<div class="empty">No symbols yet. Add from Market.</div>`}
      <button class="btn primary wide" data-nav-link="market" type="button" style="margin-top:12px">Add from market</button>
    </div>`;
}

function renderGainers() {
  const sc = state.scanner || {};
  const tab = state.gainerTab || "gainers";
  const rows = sc[tab] || sc.gainers || [];
  view.innerHTML = `
    <div id="page-anchor">
      <h1 class="h1">Scanner</h1>
      <p class="coverage">${esc((sc.coverage && sc.coverage.label) || "Limited universe — not the full market.")}</p>
      <div class="seg" role="tablist">
        <button type="button" data-gainer-tab="gainers" class="${tab === "gainers" ? "active" : ""}">Gainers</button>
        <button type="button" data-gainer-tab="highVolume" class="${tab === "highVolume" ? "active" : ""}">High volume</button>
        <button type="button" data-gainer-tab="volatile" class="${tab === "volatile" ? "active" : ""}">Volatile</button>
      </div>
      ${rows.length ? rows.map(stockRow).join("") : `<div class="empty">No scanner rows.</div>`}
    </div>`;
}

function renderMarket() {
  const q = state.search || "";
  const rows = (state.universe || []).filter((r) => {
    if (!q) return true;
    return r.symbol.includes(q) || String(r.name || "").toUpperCase().includes(q);
  });
  const snaps = rows.slice(0, 80).map((r) => state.snapshots[r.symbol] || r);
  view.innerHTML = `
    <div id="page-anchor">
      <h1 class="h1">Market</h1>
      <p class="coverage">${esc((state.status && state.status.coverage && state.status.coverage.label) || "")}. Search a ticker to open any symbol Alpaca knows.</p>
      <input class="search" id="market-search" value="${esc(q)}" placeholder="Search AAPL or Tesla" autocomplete="off" />
      ${q && !rows.some((r) => r.symbol === q) ? `<button class="btn primary wide" data-open-symbol="${esc(q)}" type="button" style="margin-bottom:10px">Open ${esc(q)}</button>` : ""}
      ${snaps.map(stockRow).join("") || `<div class="empty">No matches.</div>`}
    </div>`;
  const input = document.getElementById("market-search");
  if (input) {
    input.focus();
    input.selectionStart = input.value.length;
    input.addEventListener("input", () => {
      state.search = input.value.trim().toUpperCase();
      renderMarket();
    });
  }
}

function renderDetail() {
  try {
    const d = state.detail;
    const symbol = state.symbol;
    if (!d) {
      view.innerHTML = `<div id="page-anchor"><button class="back" data-back type="button">‹ Back</button><h1 class="h1">${esc(symbol)}</h1><p class="lede">Loading…</p></div>`;
      return;
    }
    const last = val(d.last);
    const pct = val(d.changePct);
    const watched = state.watchlist.includes(symbol);
    const rule = state.alerts[symbol] || defaultAlert(symbol);
    const hover = state.hover;
    const bars = d.bars || [];
    view.innerHTML = `
      <div id="page-anchor">
        <div class="detail-head">
          <div>
            <button class="back" data-back type="button">‹ Back</button>
            <h1 class="h1">${esc(symbol)}</h1>
            <div class="name">${esc(d.name || symbol)}</div>
          </div>
          <button class="btn ${watched ? "danger" : "primary"}" data-toggle-watch="${esc(symbol)}" type="button">${watched ? "Remove" : "Add"}</button>
        </div>
        <div class="price-xl">${fmtPrice(last)}</div>
        <div class="chg ${chgClass(pct)}">${fmtPct(pct)} · ${esc(srcLabel(d.last))}</div>
        <div class="meta-line">Prev close ${fmtPrice(val(d.prevClose))} · Vol ${fmtVol(val(d.volume))}</div>
        <div class="ohlc">
          <div><span>Open</span><b>${fmtPrice(val(d.open))}</b></div>
          <div><span>High</span><b>${fmtPrice(val(d.high))}</b></div>
          <div><span>Low</span><b>${fmtPrice(val(d.low))}</b></div>
          <div><span>Close</span><b>${fmtPrice(val(d.close))}</b></div>
        </div>
        <div class="chart-tools">
          <div class="seg">
            <button type="button" data-chart="candle" class="${state.chartType === "candle" ? "active" : ""}">Candlestick</button>
            <button type="button" data-chart="line" class="${state.chartType === "line" ? "active" : ""}">Line</button>
          </div>
        </div>
        <div class="seg">
          ${INTERVALS.map(
            (i) =>
              `<button type="button" data-tf="${i.id}" class="${state.timeframe === i.id ? "active" : ""}">${i.label}</button>`
          ).join("")}
        </div>
        <div class="chart-wrap" style="margin-top:10px">
          <div class="hover-readout" id="hover-readout">${hoverReadout(hover, bars)}</div>
          <canvas id="price-chart" height="220" style="height:220px"></canvas>
          <canvas id="volume-chart" height="72" style="height:72px"></canvas>
        </div>
        <div class="metrics">
          ${metricCard("Free Float", fmtVol(val(d.freeFloat)), d.freeFloat, "freeFloat")}
          ${metricCard("Float %", val(d.floatPct) == null ? "N/A" : `${Number(val(d.floatPct)).toFixed(1)}%`, d.floatPct, "floatPct")}
          ${metricCard("Volatility Score", val(d.volatilityScore) == null ? "N/A" : fmtNum(val(d.volatilityScore), 1), d.volatilityScore, "volatilityScore")}
          ${metricCard("Relative Volume", val(d.rvol) == null ? "N/A" : `${Number(val(d.rvol)).toFixed(2)}x`, d.rvol, "rvol")}
        </div>
        <div class="section-title"><span>Alerts</span></div>
        <div class="card alert-form">
          <div class="tiny">${esc(ruleSummary(rule))}</div>
          <label class="check"><input id="al-enabled" type="checkbox" ${rule.enabled ? "checked" : ""}/> Enable alerts for ${esc(symbol)}</label>
          <label>Daily move % threshold</label>
          <input id="al-daily" type="number" step="0.1" value="${esc(rule.dailyMovePct)}" />
          <label>Short-term move % threshold</label>
          <input id="al-short" type="number" step="0.1" value="${esc(rule.shortTermMovePct)}" />
          <label>RVOL threshold</label>
          <input id="al-rvol" type="number" step="0.1" value="${esc(rule.rvol)}" />
          <label>Volatility Score threshold</label>
          <input id="al-score" type="number" step="1" value="${esc(rule.volScore)}" />
          <button class="btn primary wide" id="al-save" type="button" style="margin-top:12px">Save alerts</button>
          <p class="tiny" style="margin-top:8px">Notifications fire only while this app is open. Closed-app push is not implemented.</p>
        </div>
      </div>`;
    requestAnimationFrame(() => paintDetailChart(bars));
    const save = document.getElementById("al-save");
    if (save) {
      save.onclick = () => {
        state.alerts[symbol] = {
          symbol,
          enabled: document.getElementById("al-enabled").checked,
          dailyMovePct: Number(document.getElementById("al-daily").value),
          shortTermMovePct: Number(document.getElementById("al-short").value),
          rvol: Number(document.getElementById("al-rvol").value),
          volScore: Number(document.getElementById("al-score").value),
        };
        saveAlerts();
        if (state.alerts[symbol].enabled && "Notification" in window && Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
        renderDetail();
      };
    }
  } catch (err) {
    console.error("detail render failed", err);
    view.innerHTML = `<div id="page-anchor"><button class="back" data-back type="button">‹ Back</button><div class="error">Could not open ${esc(state.symbol)}. ${esc(err.message)}</div></div>`;
  }
}

function metricCard(label, display, field, infoKey) {
  const note = (field && (field.note || field.approximation)) || srcLabel(field);
  return `<div class="metric">
    <div class="metric-top">${esc(label)} <button class="info-btn" data-info="${infoKey}" type="button" aria-label="About ${esc(label)}">i</button></div>
    <div class="val">${esc(display)}</div>
    <div class="src">${esc(note)}</div>
  </div>`;
}

function hoverReadout(hover, bars) {
  const bar = hover || (bars && bars[bars.length - 1]);
  if (!bar) return "Time · Price · O H L C · Volume";
  const t = formatBarTime(bar.t);
  return `<b>${esc(t)}</b><br>Price ${fmtPrice(bar.c)} · O ${fmtPrice(bar.o)} · H ${fmtPrice(bar.h)} · L ${fmtPrice(bar.l)} · C ${fmtPrice(bar.c)} · Vol ${fmtVol(bar.v)}`;
}

function formatBarTime(t) {
  if (!t) return "N/A";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function paintDetailChart(bars) {
  const price = document.getElementById("price-chart");
  const volume = document.getElementById("volume-chart");
  if (!price || !volume || !window.VoltScanCharts) return;
  const hoverIndex = state.hover ? bars.indexOf(state.hover) : bars.length - 1;
  window.VoltScanCharts.drawChart(price, volume, bars, {
    type: state.chartType,
    hoverIndex,
  });
  window.VoltScanCharts.bindHover(price, bars, (idx, bar) => {
    state.hover = bar;
    const el = document.getElementById("hover-readout");
    if (el) el.innerHTML = hoverReadout(bar, bars);
    window.VoltScanCharts.drawChart(price, volume, bars, {
      type: state.chartType,
      hoverIndex: idx,
    });
  });
}

function renderAlerts() {
  const symbols = Object.keys(state.alerts);
  view.innerHTML = `
    <div id="page-anchor">
      <button class="back" data-back type="button">‹ Back</button>
      <h1 class="h1">Alert settings</h1>
      <p class="lede">Thresholds are checked while VoltScan is open. Open a stock to edit its rules.</p>
      ${
        symbols.length
          ? symbols
              .map((s) => {
                const rule = state.alerts[s];
                return `<button class="stock-row" data-open-symbol="${esc(s)}" type="button"><div><div class="sym">${esc(s)}</div><div class="name">${esc(ruleSummary(rule))}</div></div><div class="chg">${rule.enabled ? "ON" : "off"}</div></button>`;
              })
              .join("")
          : `<div class="empty">No saved alert rules yet.</div>`
      }
    </div>`;
}

function renderHistory() {
  view.innerHTML = `
    <div id="page-anchor">
      <button class="back" data-back type="button">‹ Back</button>
      <h1 class="h1">Alert history</h1>
      ${
        state.history.length
          ? state.history
              .map(
                (h) =>
                  `<button class="stock-row" data-open-symbol="${esc(h.symbol)}" type="button"><div><div class="sym">${esc(h.symbol)}</div><div class="name">${esc(h.message)}</div></div><div class="tiny">${esc(formatBarTime(h.at))}</div></button>`
              )
              .join("")
          : `<div class="empty">No alerts fired yet.</div>`
      }
    </div>`;
}

function showInfo(key) {
  const titles = {
    freeFloat: "Free Float",
    floatPct: "Float %",
    volatilityScore: "Volatility Score",
    rvol: "Relative Volume",
  };
  modal.classList.remove("hidden");
  modal.innerHTML = `<div class="sheet"><h2>${esc(titles[key] || "Info")}</h2><p>${esc(INFO[key] || "")}</p><button class="btn primary wide" id="close-modal" type="button" style="margin-top:16px">Got it</button></div>`;
  document.getElementById("close-modal").onclick = closeModal;
}

function closeModal() {
  modal.classList.add("hidden");
  modal.innerHTML = "";
}

function openStock(symbol) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return;
  if (state.route !== "stock" || state.symbol !== sym) {
    state.detail = null;
    state.hover = null;
  }
  go(`/stock/${sym}`);
}

async function loadStock(symbol) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return;
  state.symbol = sym;
  if (!state.detail || state.detail.symbol !== sym) {
    state.detail = null;
    state.hover = null;
    render();
    landTop();
  }
  try {
    const detail = await api(`/api/detail/${encodeURIComponent(sym)}?timeframe=${encodeURIComponent(state.timeframe)}`);
    if (state.route === "stock" && state.symbol === sym) {
      state.detail = detail;
      render();
      landTop();
    }
  } catch (err) {
    console.error(err);
    state.detail = {
      symbol: sym,
      name: sym,
      last: { value: null, source: "UNAVAILABLE" },
      error: err.message,
      bars: [],
      freeFloat: { value: null, source: "UNAVAILABLE", note: "Float data unavailable from current provider" },
      floatPct: { value: null, source: "UNAVAILABLE", note: "Float data unavailable from current provider" },
      volatilityScore: { value: null, source: "UNAVAILABLE" },
      rvol: { value: null, source: "UNAVAILABLE" },
    };
    render();
  }
}

function toggleWatch(symbol) {
  const sym = symbol.toUpperCase();
  if (state.watchlist.includes(sym)) {
    state.watchlist = state.watchlist.filter((s) => s !== sym);
  } else {
    state.watchlist.unshift(sym);
  }
  saveWatchlist();
  render();
}

async function refreshStatus() {
  state.status = await api("/api/status");
  setStatusPill();
}

async function refreshWatchSnapshots() {
  if (!state.watchlist.length) return;
  const data = await api(`/api/snapshots?symbols=${encodeURIComponent(state.watchlist.join(","))}`);
  for (const snap of data.snapshots || []) state.snapshots[snap.symbol] = snap;
  evaluateAlerts(data.snapshots || []);
}

async function refreshScanner() {
  state.scanner = await api("/api/scanner");
  for (const key of ["gainers", "highVolume", "volatile"]) {
    for (const snap of state.scanner[key] || []) state.snapshots[snap.symbol] = snap;
  }
}

async function refreshUniverse() {
  const data = await api("/api/universe");
  state.universe = data.symbols || [];
  const first = state.universe.slice(0, 40).map((r) => r.symbol);
  if (first.length) {
    const snaps = await api(`/api/snapshots?symbols=${encodeURIComponent(first.join(","))}`);
    for (const snap of snaps.snapshots || []) state.snapshots[snap.symbol] = snap;
  }
}

function evaluateAlerts(snaps) {
  for (const snap of snaps || []) {
    const rule = state.alerts[snap.symbol];
    if (!rule || !rule.enabled) continue;
    const hits = [];
    const daily = Math.abs(Number(val(snap.changePct)));
    const rvol = Number(val(snap.rvol));
    const score = Number(val(snap.volatilityScore));
    if (Number.isFinite(daily) && daily >= Number(rule.dailyMovePct)) hits.push(`Daily move ${fmtPct(val(snap.changePct))}`);
    if (Number.isFinite(rvol) && rvol >= Number(rule.rvol)) hits.push(`RVOL ${rvol.toFixed(2)}x`);
    if (Number.isFinite(score) && score >= Number(rule.volScore)) hits.push(`Vol score ${score}`);
    if (!hits.length) continue;
    const key = `${snap.symbol}:${hits.join(",")}:${new Date().toISOString().slice(0, 16)}`;
    if (state.history.some((h) => h.key === key)) continue;
    const rec = { key, symbol: snap.symbol, message: hits.join(" · "), at: new Date().toISOString() };
    state.history.unshift(rec);
    saveHistory();
    notify(`${snap.symbol} alert`, rec.message);
  }
}

function notify(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: title });
    } catch {}
  }
}

async function routeChanged() {
  parseRoute();
  render();
  landTop();
  try {
    if (state.route === "stock") await loadStock(state.symbol);
    else if (state.route === "gainers") {
      if (!state.scanner) await refreshScanner();
      render();
    } else if (state.route === "market") {
      if (!state.universe.length) await refreshUniverse();
      render();
    } else if (state.route === "watchlist" || state.route === "home") {
      await refreshWatchSnapshots();
      if (state.route === "home" && !state.scanner) await refreshScanner();
      render();
    }
  } catch (err) {
    console.error(err);
    state.lastError = err.message;
    banner.textContent = err.message;
    banner.classList.remove("hidden");
  }
}

view.addEventListener("click", (ev) => {
  const open = ev.target.closest("[data-open-symbol]");
  if (open) {
    openStock(open.getAttribute("data-open-symbol"));
    return;
  }
  const info = ev.target.closest("[data-info]");
  if (info) {
    showInfo(info.getAttribute("data-info"));
    return;
  }
  const nav = ev.target.closest("[data-nav-link]");
  if (nav) {
    const dest = nav.getAttribute("data-nav-link");
    go(dest === "history" ? "/alerts/history" : `/${dest}`);
    return;
  }
  if (ev.target.closest("[data-back]")) {
    history.length > 1 ? history.back() : go("/home");
    return;
  }
  const watch = ev.target.closest("[data-toggle-watch]");
  if (watch) {
    toggleWatch(watch.getAttribute("data-toggle-watch"));
    return;
  }
  const chart = ev.target.closest("[data-chart]");
  if (chart) {
    state.chartType = chart.getAttribute("data-chart");
    render();
    return;
  }
  const tf = ev.target.closest("[data-tf]");
  if (tf) {
    state.timeframe = tf.getAttribute("data-tf");
    if (state.symbol && state.route === "stock") loadStock(state.symbol);
    else render();
    return;
  }
  const gtab = ev.target.closest("[data-gainer-tab]");
  if (gtab) {
    state.gainerTab = gtab.getAttribute("data-gainer-tab");
    render();
  }
});

document.querySelector(".tabbar").addEventListener("click", (ev) => {
  const tab = ev.target.closest("[data-nav]");
  if (!tab) return;
  go(`/${tab.dataset.nav}`);
});

document.getElementById("brand-btn").addEventListener("click", () => go("/home"));
modal.addEventListener("click", (ev) => {
  if (ev.target === modal) closeModal();
});

window.addEventListener("hashchange", routeChanged);

async function boot() {
  parseRoute();
  render();
  try {
    await refreshStatus();
    if (Notification && Notification.permission === "default") {
      /* permission requested only from alert save / first enable would be nicer; keep quiet */
    }
    await refreshWatchSnapshots();
    await routeChanged();
  } catch (err) {
    console.error(err);
    banner.textContent = err.message;
    banner.classList.remove("hidden");
    render();
  }
  setInterval(async () => {
    try {
      await refreshWatchSnapshots();
      if (state.route === "home" || state.route === "watchlist" || state.route === "gainers") render();
      if (state.route === "stock" && state.symbol) {
        const detail = await api(`/api/detail/${encodeURIComponent(state.symbol)}?timeframe=${encodeURIComponent(state.timeframe)}`);
        state.detail = detail;
        if (state.route === "stock") render();
      }
    } catch (err) {
      console.warn(err);
    }
  }, 45000);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(`/sw.js?v=${ASSET_V}`).catch((err) => console.warn("sw", err));
}

boot();
