"use strict";

require("dotenv").config();

const path = require("path");
const express = require("express");
const { getProvider, getStatus, normalizeTimeframe, credentialsFromEnv } = require("./data-provider");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    res.set("Cache-Control", "no-store");
  }
  next();
});

function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function parseSymbols(input) {
  if (!input) return [];
  return String(input)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 80);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "voltscan" });
});

app.get(
  "/api/status",
  asyncRoute(async (_req, res) => {
    const creds = credentialsFromEnv();
    const status = await getStatus();
    res.json({
      ...status,
      credentialsConfigured: creds.configured,
      notifications: {
        browser: true,
        closedAppPush: false,
        note: "Browser notifications only work while VoltScan is open and scanning. Closed-app push is not implemented.",
      },
    });
  })
);

app.get(
  "/api/universe",
  asyncRoute(async (req, res) => {
    const provider = await getProvider();
    const data = await provider.getMarketUniverse();
    const q = String(req.query.q || "").trim().toUpperCase();
    if (q) {
      data.symbols = data.symbols.filter(
        (row) => row.symbol.includes(q) || String(row.name || "").toUpperCase().includes(q)
      );
    }
    res.json(data);
  })
);

app.get(
  "/api/snapshots",
  asyncRoute(async (req, res) => {
    const symbols = parseSymbols(req.query.symbols);
    if (!symbols.length) {
      res.status(400).json({ error: "symbols query required" });
      return;
    }
    const provider = await getProvider();
    const snapshots = await provider.getWatchlistSnapshots(symbols);
    res.json({ snapshots, status: provider.getStatus() });
  })
);

app.get(
  "/api/quote/:symbol",
  asyncRoute(async (req, res) => {
    const provider = await getProvider();
    const snapshot = await provider.getQuote(req.params.symbol);
    res.json(snapshot);
  })
);

app.get(
  "/api/snapshot/:symbol",
  asyncRoute(async (req, res) => {
    const provider = await getProvider();
    const snapshot = await provider.getSnapshot(req.params.symbol);
    res.json(snapshot);
  })
);

app.get(
  "/api/bars/:symbol",
  asyncRoute(async (req, res) => {
    const provider = await getProvider();
    const timeframe = normalizeTimeframe(req.query.timeframe);
    const data = await provider.getBars(req.params.symbol, timeframe, req.query.from, req.query.to);
    res.json(data);
  })
);

app.get(
  "/api/detail/:symbol",
  asyncRoute(async (req, res) => {
    const provider = await getProvider();
    const timeframe = normalizeTimeframe(req.query.timeframe || "5Min");
    const detail = await provider.getDetail(req.params.symbol, timeframe);
    res.json({ ...detail, status: provider.getStatus() });
  })
);

app.get(
  "/api/scanner",
  asyncRoute(async (_req, res) => {
    const provider = await getProvider();
    const movers = await provider.getMovers();
    res.json({ ...movers, status: provider.getStatus() });
  })
);

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".js") || filePath.endsWith(".css") || filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: err.message || "Server error",
    source: "UNAVAILABLE",
  });
});

async function main() {
  const status = await getStatus();
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`VoltScan http://localhost:${PORT}`);
    console.log(`Data: ${status.label}`);
    if (status.warning) console.warn(`Warning: ${status.warning}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Set PORT to another value.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}

module.exports = { app, main };
