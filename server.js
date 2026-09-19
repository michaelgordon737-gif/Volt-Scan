"use strict";

require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { getProvider, getStatus, credentialsFromEnv } = require("./data-provider");
const { optionalNumber } = require("./data-provider/sources");
const tournament = require("./data-provider/tournament");
const cornhole = require("./data-provider/cornhole");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 200000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function safeSymbol(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 15);
}

function n(v) {
  return optionalNumber(v);
}

function filterAndSort(rows, url) {
  let out = rows;
  const q = (url.searchParams.get("search") || "").trim().toLowerCase();
  const priceMax = n(url.searchParams.get("priceMax"));
  const priceMin = n(url.searchParams.get("priceMin"));
  const floatMax = n(url.searchParams.get("floatMax"));
  const floatMin = n(url.searchParams.get("floatMin"));
  const volumeMin = n(url.searchParams.get("volumeMin"));
  const gainMin = n(url.searchParams.get("gainMin"));
  const commonOnly = url.searchParams.get("commonOnly") === "true";
  if (q) out = out.filter((r) => r.ticker.toLowerCase().includes(q) || String(r.name || "").toLowerCase().includes(q));
  if (priceMin !== null) out = out.filter((r) => r.price !== null && r.price >= priceMin);
  if (priceMax !== null) out = out.filter((r) => r.price !== null && r.price <= priceMax);
  if (floatMin !== null) out = out.filter((r) => r.float !== null && r.float >= floatMin);
  if (floatMax !== null) out = out.filter((r) => r.float !== null && r.float <= floatMax);
  if (volumeMin !== null) out = out.filter((r) => r.volume !== null && r.volume >= volumeMin);
  if (gainMin !== null) out = out.filter((r) => r.changePct !== null && r.changePct >= gainMin);
  if (commonOnly) out = out.filter((r) => r.type === "CS");
  const sort = url.searchParams.get("sort") || "gain";
  const cmp = {
    gain: (a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity),
    volume: (a, b) => (b.volume ?? -Infinity) - (a.volume ?? -Infinity),
    float: (a, b) => (a.float ?? Infinity) - (b.float ?? Infinity),
    price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    ticker: (a, b) => a.ticker.localeCompare(b.ticker),
  }[sort] || ((a, b) => a.ticker.localeCompare(b.ticker));
  return out.sort(cmp);
}

async function handleCornholeApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && parts.length === 2) {
    return sendJson(res, 200, cornhole.getState());
  }
  if (req.method === "POST" && parts.length === 3 && parts[2] === "games") {
    const body = await readJson(req);
    const result = cornhole.startGame(body);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 201, result);
  }
  if (parts.length === 5 && parts[2] === "games" && parts[4] === "bag" && req.method === "POST") {
    const body = await readJson(req);
    const result = cornhole.recordBag(parts[3], body);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, result);
  }
  if (parts.length === 5 && parts[2] === "games" && parts[4] === "undo" && req.method === "POST") {
    const result = cornhole.undoBag(parts[3]);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, result);
  }
  if (parts.length === 5 && parts[2] === "matches" && parts[4] === "winner" && req.method === "POST") {
    const body = await readJson(req);
    const result = cornhole.setWinner(parts[3], body.side);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, result);
  }
  return sendJson(res, 404, { error: "Unknown cornhole route." });
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/cornhole" || url.pathname.startsWith("/api/cornhole/")) {
    try {
      return await handleCornholeApi(req, res, url);
    } catch (e) {
      return sendJson(res, e.message === "Invalid JSON" ? 400 : 500, { error: e.message });
    }
  }

  if (url.pathname === "/api/status") {
    const creds = credentialsFromEnv();
    const status = await getStatus();
    return sendJson(res, 200, {
      ...status,
      hasApiKey: creds.configured,
      notifications: {
        browser: true,
        closedAppPush: false,
        note: "Browser notifications only work while VoltScan is open and scanning. Closed-app push is not implemented.",
      },
    });
  }

  const provider = await getProvider();
  const mode = provider.getStatus().mode;

  if (url.pathname === "/api/market") {
    try {
      const source = await provider.getMarket();
      const filtered = filterAndSort(source.rows, url);
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit") || 50)));
      const start = (page - 1) * limit;
      return sendJson(res, 200, {
        status: "OK",
        mode,
        priceDataAvailable: source.priceDataAvailable,
        snapshotError: source.snapshotError,
        coverage: source.coverage,
        total: filtered.length,
        page,
        limit,
        rows: filtered.slice(start, start + limit),
      });
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }

  if (url.pathname === "/api/gainers") {
    try {
      const source = await provider.getGainers();
      return sendJson(res, 200, {
        status: "OK",
        mode,
        rows: source.rows || [],
        tickers: source.tickers || [],
        priceDataAvailable: source.priceDataAvailable !== false,
        coverage: source.coverage,
        error: source.error || null,
      });
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }

  if (url.pathname === "/api/snapshots") {
    const syms = [...new Set((url.searchParams.get("symbols") || "").split(",").map(safeSymbol).filter(Boolean).slice(0, 50))];
    if (!syms.length) return sendJson(res, 400, { error: "No symbols supplied." });
    try {
      const data = await provider.getSnapshots(syms);
      return sendJson(res, 200, { ...data, mode });
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }

  if (url.pathname.startsWith("/api/bars/")) {
    const sym = safeSymbol(decodeURIComponent(url.pathname.split("/").pop()));
    const interval = String(url.searchParams.get("interval") || "5m");
    if (!sym) return sendJson(res, 400, { error: "Invalid symbol." });
    if (!["1m", "5m", "15m", "30m", "1h", "1d"].includes(interval)) {
      return sendJson(res, 400, { error: "Unsupported interval." });
    }
    try {
      const data = await provider.getBars(sym, interval);
      return sendJson(res, 200, { ...data, mode });
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }

  if (url.pathname === "/api/tournaments" || url.pathname.startsWith("/api/tournaments/")) {
    try {
      return await handleTournamentApi(req, res, url, provider);
    } catch (e) {
      return sendJson(res, e.message === "Invalid JSON" ? 400 : 500, { error: e.message });
    }
  }

  if (url.pathname.startsWith("/api/ticker/")) {
    const sym = safeSymbol(decodeURIComponent(url.pathname.split("/").pop()));
    if (!sym) return sendJson(res, 400, { error: "Invalid symbol." });
    try {
      const data = await provider.getTicker(sym);
      return sendJson(res, 200, { ...data, mode });
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }

  return sendJson(res, 404, { error: "Unknown API route." });
}

async function marksFor(provider, symbols) {
  const unique = [...new Set(symbols.filter(Boolean))].slice(0, 50);
  const marks = {};
  if (!unique.length) return marks;
  try {
    const data = await provider.getSnapshots(unique);
    for (const s of data.tickers || []) {
      const p = tournament.snapshotPrice(s);
      if (s?.ticker && p != null) marks[s.ticker] = p;
    }
  } catch { /* leaderboard still shows cash-only marks */ }
  return marks;
}

async function handleTournamentApi(req, res, url, provider) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && parts.length === 2) {
    return sendJson(res, 200, { tournaments: tournament.listTournaments() });
  }
  if (req.method === "POST" && parts.length === 2) {
    const body = await readJson(req);
    const created = tournament.createTournament(body);
    return sendJson(res, 201, created);
  }
  if (parts.length === 3 && req.method === "GET") {
    const raw = tournament.load().store.tournaments.find((t) => t.id === parts[2].toUpperCase());
    if (!raw) return sendJson(res, 404, { error: "Tournament not found." });
    const symbols = raw.players.flatMap((p) => Object.keys(p.positions || {}));
    return sendJson(res, 200, tournament.publicTournament(raw, await marksFor(provider, symbols)));
  }
  if (parts.length === 4 && parts[3] === "join" && req.method === "POST") {
    const body = await readJson(req);
    const result = tournament.joinTournament(parts[2], body.name);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, result);
  }
  if (parts.length === 4 && parts[3] === "trade" && req.method === "POST") {
    const body = await readJson(req);
    const sym = safeSymbol(body.symbol);
    let price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) {
      try {
        const data = await provider.getSnapshots([sym]);
        price = tournament.snapshotPrice((data.tickers || [])[0]);
      } catch {
        price = null;
      }
    }
    const result = tournament.tradeTournament(parts[2], { ...body, symbol: sym, price });
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, result);
  }
  return sendJson(res, 404, { error: "Unknown tournament route." });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "/cornhole") rel = "/cornhole.html";
  if (rel === "/scan") rel = "/index.html";
  const normalized = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const noCache = ext === ".html" || ext === ".js" || ext === ".css";
    res.writeHead(200, {
      "Content-Type": mime[ext] || "application/octet-stream",
      "Cache-Control": noCache ? "no-cache" : "public, max-age=300",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/health") return sendJson(res, 200, { ok: true, service: "cornhole" });
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message || "Server error" });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set PORT to another value.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Backyard Cornhole at http://localhost:${PORT}`);
    console.log(`VoltScan scanner still at http://localhost:${PORT}/scan`);
    getStatus()
      .then((status) => {
        console.log(`Scanner data: ${status.label}`);
        if (status.warning) console.warn(`Warning: ${status.warning}`);
      })
      .catch((err) => console.warn(err.message || err));
  });
}

module.exports = { server, handleApi };
