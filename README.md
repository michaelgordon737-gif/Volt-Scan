# VoltScan Final + Alpaca

Phone-friendly stock scanner / PWA. This is the uploaded **VoltScan_Final** app with Massive replaced by a server-side **Alpaca** market-data provider. The UI, charts, watchlist, alerts, and stock-row navigation are the original Final package.

A copy of the uploaded zip is `VoltScan_Final.zip`. A pre-edit extract is in `backups/VoltScan_Final/` (local only).

## Start

```bash
cp .env.example .env   # fill Alpaca keys, or leave blank for DEMO
npm install
node server.js
```

Open http://localhost:3000

## Environment variables

```text
ALPACA_API_KEY=
ALPACA_SECRET_KEY=
ALPACA_DATA_FEED=delayed_sip
PORT=3000
```

Keys stay on the Node server. They are never sent to the browser, HTML, service worker, or localStorage.

Without keys the app runs in **DEMO DATA**. Demo numbers are labeled and are not market data.

## Data truth

| Field | With Alpaca keys | Without keys |
|---|---|---|
| Price, prev close, %, OHLC, volume, candles | Alpaca | DEMO |
| `delayed_sip` | ~15 min delayed SIP (not labeled live) | — |
| IEX fallback | Labeled `IEX REAL-TIME` (partial tape) | — |
| Free float / float % | **N/A** (Alpaca does not provide this) | Simulated and marked DEMO |
| Scanner coverage | Limited liquid universe + optional Alpaca movers — **not full market** | Simulated sample |

Relative Volume is an approximation (today vs prior-day volume scaled by elapsed regular session). Volatility Score is a deterministic 0–100 scanner blend, not investment advice.

## Tests

```bash
npm test
```
