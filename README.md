# VoltScan

Phone-first stock volatility and volume scanner. Market data is proxied through a local Node server so Alpaca keys never reach the browser.

The GitHub repo this work started from contained only a README (`# Volt-Scan`). There was no `VoltScan_Final` package in source control, so this tree reconstructs the described working PWA and replaces simulated market values with an Alpaca provider.

## Start

```bash
cp .env.example .env   # then fill Alpaca keys, or leave blank for DEMO
npm install
node server.js
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ALPACA_API_KEY` | for live data | empty | Alpaca Key ID (server only) |
| `ALPACA_SECRET_KEY` | for live data | empty | Alpaca Secret (server only) |
| `ALPACA_DATA_FEED` | no | `delayed_sip` | Preferred feed (`delayed_sip`, `iex`, or `sip`) |
| `PORT` | no | `3000` | HTTP port |

If keys are missing, the app starts in **DEMO DATA** with a visible banner. It does not pretend those numbers are real.

Do not put keys in frontend JS, HTML, the service worker, or localStorage.

## What is real vs delayed vs unavailable

With Alpaca keys:

- **Real Alpaca data:** last price, previous close, daily %, open/high/low/close, volume, historical candles, candle volume, watchlist prices, stock detail prices, scanner ranks inside the supported universe.
- **Delay:** `delayed_sip` is about **15 minutes delayed** consolidated SIP. The header shows `ALPACA • 15 MIN DELAYED`. It is never labeled live.
- **IEX fallback:** if `delayed_sip` is not entitled, the app probes `iex` and labels `ALPACA • IEX REAL-TIME`, with a warning that IEX is a partial tape.
- **Unavailable:** free float, float %, shares outstanding — Alpaca does not provide these. Cards stay visible and show **N/A** plus `Float data unavailable from current provider`.
- **Demo:** only when keys are missing. Header is `DEMO DATA`.

## Coverage

Top gainers / high volume / volatile lists are **not a full U.S. market scan**. They use Alpaca’s movers/most-actives screener when the plan allows, plus a cached liquid universe (~180 symbols) and your watchlist. The UI states this coverage on Home, Scanner, and Market.

## Metrics

Documented in `data-provider/metrics.js`:

- **Relative Volume:** session-comparable cumulative volume vs the same elapsed regular session over the prior 10 days. Falls back to daily volume / ADV. Approximate — not institutional RVOL.
- **Volatility Score:** deterministic 0–100 blend of daily % move, ~30-minute move, RVOL, and intraday range. Scanner metric only. Not investment advice.

## Architecture

```
server.js                 # static files + /api proxy
data-provider/            # marketDataProvider abstraction
  alpaca-provider.js      # AlpacaMarketDataProvider
  demo-provider.js        # DemoMarketDataProvider (explicit DEMO source)
  metrics.js
  universe.js
public/                   # PWA
```

Watchlist and alert rules persist in `localStorage`.

## Tests

```bash
npm test
```

## Notifications

Browser notifications can fire **while the app is open**. Closed-app push (Web Push / FCM / APNs) is not implemented.
