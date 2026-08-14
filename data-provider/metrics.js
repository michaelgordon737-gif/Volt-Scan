"use strict";

/**
 * VoltScan scanner metrics.
 *
 * These are monitoring heuristics, not buy/sell signals or investment advice.
 * Formulas are deterministic: same inputs always produce the same outputs.
 */

const RVOL_LOOKBACK_SESSIONS = 10;

/**
 * Relative Volume (session-comparable, approximate).
 *
 *   current cumulative volume for comparable elapsed regular session
 *   ---------------------------------------------------------------
 *   average cumulative volume at the same elapsed point in prior N sessions
 *
 * Regular session is treated as 09:30–16:00 America/New_York.
 *
 * This is NOT institutional “exact” RVOL:
 * - Pre/post-market volume is ignored.
 * - N defaults to 10 prior sessions (not a 30-day VWAP desk model).
 * - On IEX, volume is exchange-partial, so RVOL is not SIP-comparable.
 * - If minute bars are missing, callers may fall back to daily-volume / ADV.
 *
 * @param {number} currentCumVolume
 * @param {number[]} priorCumVolumesAtSameElapsed  prior sessions, same elapsed minutes
 * @returns {number|null}
 */
function relativeVolume(currentCumVolume, priorCumVolumesAtSameElapsed) {
  if (!isFiniteNumber(currentCumVolume) || currentCumVolume < 0) return null;
  const priors = (priorCumVolumesAtSameElapsed || []).filter(
    (v) => isFiniteNumber(v) && v > 0
  );
  if (!priors.length) return null;
  const avg = priors.reduce((s, v) => s + v, 0) / priors.length;
  if (!(avg > 0)) return null;
  return currentCumVolume / avg;
}

/**
 * Simpler list/scanner RVOL: today's volume vs average daily volume.
 * Documented as approximate. Used when minute-bar RVOL is too heavy.
 *
 * @param {number} currentDayVolume
 * @param {number[]} priorDayVolumes
 * @returns {number|null}
 */
function dailyRelativeVolume(currentDayVolume, priorDayVolumes) {
  return relativeVolume(currentDayVolume, priorDayVolumes);
}

/**
 * Volatility Score, 0–100.
 *
 * Blend of available components (weights redistributed if a component is missing):
 *  30%  absolute daily % move vs previous close, capped at 10%
 *  20%  absolute short-term % move (typically ~30 minutes), capped at 4%
 *  30%  relative-volume pace (RVOL 1.0 → 0, RVOL 4.0 → 100)
 *  20%  intraday range % vs previous close, capped at 8%
 *
 * Missing components are skipped. If nothing can be scored, returns null (N/A).
 * Never random. Not a forecast and not investment advice.
 */
function volatilityScore({
  last,
  prevClose,
  open,
  high,
  low,
  shortTermPct,
  rvol,
} = {}) {
  const parts = [];

  const dailyPct = pctChange(last, prevClose);
  if (dailyPct != null) {
    parts.push({ value: scaleAbs(dailyPct, 10), weight: 0.3 });
  }

  if (isFiniteNumber(shortTermPct)) {
    parts.push({ value: scaleAbs(shortTermPct, 4), weight: 0.2 });
  }

  if (isFiniteNumber(rvol)) {
    const rvolScore = clamp(0, 100, ((rvol - 1) / 3) * 100);
    parts.push({ value: rvolScore, weight: 0.3 });
  }

  const rangeBase = isFiniteNumber(prevClose)
    ? prevClose
    : isFiniteNumber(open)
      ? open
      : null;
  if (isFiniteNumber(high) && isFiniteNumber(low) && isFiniteNumber(rangeBase) && rangeBase > 0) {
    const rangePct = ((high - low) / rangeBase) * 100;
    parts.push({ value: scaleAbs(rangePct, 8), weight: 0.2 });
  }

  if (!parts.length) return null;
  const weightSum = parts.reduce((s, p) => s + p.weight, 0);
  const raw = parts.reduce((s, p) => s + p.value * (p.weight / weightSum), 0);
  return Math.round(clamp(0, 100, raw) * 10) / 10;
}

function pctChange(current, baseline) {
  if (!isFiniteNumber(current) || !isFiniteNumber(baseline) || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

function scaleAbs(pct, capPct) {
  return clamp(0, 100, (Math.abs(pct) / capPct) * 100);
}

function clamp(min, max, n) {
  return Math.min(max, Math.max(min, n));
}

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Regular-session elapsed minutes in America/New_York.
 * Returns 0 before 09:30, 390 at/after 16:00, or null if clock cannot be read.
 */
function regularSessionElapsedMinutes(date = new Date(), timeZone = "America/New_York") {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const weekday = map.weekday;
    if (weekday === "Sat" || weekday === "Sun") return 390;
    const minutes = Number(map.hour) * 60 + Number(map.minute);
    const open = 9 * 60 + 30;
    const close = 16 * 60;
    if (minutes < open) return 0;
    if (minutes >= close) return 390;
    return minutes - open;
  } catch {
    return null;
  }
}

function nyDateKey(date, timeZone = "America/New_York") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Sum bar volume for each NY session, truncated to `elapsedMinutes` from 09:30.
 * `bars` are 1-minute bars with `{ t, v }`.
 */
function cumulativeVolumeBySession(minuteBars, elapsedMinutes) {
  const cap = Number.isFinite(elapsedMinutes) ? elapsedMinutes : 390;
  const byDay = new Map();
  for (const bar of minuteBars || []) {
    if (!bar || !bar.t) continue;
    const dt = new Date(bar.t);
    if (Number.isNaN(dt.getTime())) continue;
    const day = nyDateKey(dt);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(dt);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const minutes = Number(map.hour) * 60 + Number(map.minute);
    const elapsed = minutes - (9 * 60 + 30);
    if (elapsed < 0 || elapsed >= cap) continue;
    byDay.set(day, (byDay.get(day) || 0) + (Number(bar.v) || 0));
  }
  return byDay;
}

function sessionComparableRvol(minuteBars, now = new Date()) {
  const elapsed = regularSessionElapsedMinutes(now);
  if (elapsed == null) return { rvol: null, method: null, elapsedMinutes: null };
  const effectiveElapsed = elapsed === 0 ? 390 : elapsed;
  const byDay = cumulativeVolumeBySession(minuteBars, effectiveElapsed);
  const today = nyDateKey(now);
  const days = [...byDay.keys()].sort();
  const current = byDay.get(today);
  const priors = days.filter((d) => d < today).slice(-RVOL_LOOKBACK_SESSIONS).map((d) => byDay.get(d));
  if (isFiniteNumber(current) && priors.length) {
    return {
      rvol: relativeVolume(current, priors),
      method: "session_comparable",
      elapsedMinutes: effectiveElapsed,
      currentCumVolume: current,
      priorCount: priors.length,
      lookbackSessions: RVOL_LOOKBACK_SESSIONS,
    };
  }
  return { rvol: null, method: null, elapsedMinutes: effectiveElapsed };
}

function shortTermPctFromBars(minuteBars, lastPrice, lookbackMinutes = 30) {
  if (!isFiniteNumber(lastPrice) || !minuteBars || minuteBars.length < 2) return null;
  const cutoff = Date.now() - lookbackMinutes * 60 * 1000;
  let baseline = null;
  for (const bar of minuteBars) {
    const ts = Date.parse(bar.t);
    if (!Number.isFinite(ts)) continue;
    if (ts <= cutoff) baseline = bar.c;
  }
  if (!isFiniteNumber(baseline) && minuteBars.length) {
    const idx = Math.max(0, minuteBars.length - lookbackMinutes);
    baseline = minuteBars[idx] && minuteBars[idx].c;
  }
  return pctChange(lastPrice, baseline);
}

module.exports = {
  RVOL_LOOKBACK_SESSIONS,
  relativeVolume,
  dailyRelativeVolume,
  volatilityScore,
  pctChange,
  regularSessionElapsedMinutes,
  cumulativeVolumeBySession,
  sessionComparableRvol,
  shortTermPctFromBars,
  clamp,
};
