"use strict";

const { DemoMarketDataProvider } = require("./demo-provider");
const { AlpacaMarketDataProvider, TIMEFRAME_MAP } = require("./alpaca-provider");
const { SOURCE, displayLabel } = require("./sources");
const { coverageMeta } = require("./universe");

let singleton = null;

function credentialsFromEnv(env = process.env) {
  const apiKey = String(env.ALPACA_API_KEY || env.APCA_API_KEY_ID || "").trim();
  const secretKey = String(env.ALPACA_SECRET_KEY || env.APCA_API_SECRET_KEY || "").trim();
  const preferredFeed = String(env.ALPACA_DATA_FEED || "delayed_sip").trim() || "delayed_sip";
  return { apiKey, secretKey, preferredFeed, configured: Boolean(apiKey && secretKey) };
}

async function createProvider(env = process.env) {
  const creds = credentialsFromEnv(env);
  if (!creds.configured) {
    return new DemoMarketDataProvider();
  }
  const alpaca = new AlpacaMarketDataProvider({
    apiKey: creds.apiKey,
    secretKey: creds.secretKey,
    preferredFeed: creds.preferredFeed,
  });
  await alpaca.init();
  return alpaca;
}

async function getProvider() {
  if (!singleton) singleton = createProvider();
  return singleton;
}

function resetProvider() {
  singleton = null;
}

async function getStatus() {
  const provider = await getProvider();
  return provider.getStatus();
}

function normalizeTimeframe(input) {
  if (!input) return "5Min";
  return TIMEFRAME_MAP[input] || input;
}

module.exports = {
  SOURCE,
  displayLabel,
  coverageMeta,
  credentialsFromEnv,
  createProvider,
  getProvider,
  resetProvider,
  getStatus,
  normalizeTimeframe,
  TIMEFRAME_MAP,
};
