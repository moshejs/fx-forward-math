/**
 * fx-forward-math — FX quote and forward conventions math.
 *
 * The trading-desk arithmetic that consumer money libraries ignore: forward
 * points ↔ outright forwards with correct per-pair pip scaling, cross-rate
 * derivation, triangular-arbitrage checks, pip / big-figure handling, and pip
 * value. Pure functions, zero dependencies.
 *
 * A currency pair is written "BASE/QUOTE" (e.g. "EUR/USD"): the rate is how
 * many QUOTE units one BASE unit buys.
 */

export interface PairConvention {
  /** Decimal places a spot rate is quoted to (EUR/USD → 4, USD/JPY → 2). */
  pipDecimals: number;
}

/**
 * Per-pair (and per-quote-currency) pip conventions. JPY and other pairs
 * quoted to 2 dp have a pip of 0.01; most others 0.0001. Overridable.
 */
const QUOTE_PIP_DECIMALS: Record<string, number> = {
  JPY: 2,
  KRW: 2,
  CLP: 2,
  HUF: 2,
  IDR: 2,
  TWD: 2,
};

const DEFAULT_PIP_DECIMALS = 4;
const PAIR_RE = /^([A-Z]{3})\/([A-Z]{3})$/;

export interface Pair {
  base: string;
  quote: string;
}

/** Parse "EUR/USD" into `{ base, quote }`. Throws on malformed input. */
export function parsePair(pair: string): Pair {
  const m = PAIR_RE.exec(pair.trim().toUpperCase());
  if (!m) throw new RangeError(`Invalid currency pair: "${pair}" (expected "BASE/QUOTE")`);
  if (m[1] === m[2]) throw new RangeError(`Base and quote currency are identical in "${pair}"`);
  return { base: m[1]!, quote: m[2]! };
}

/**
 * Decimal places a pair's spot rate is quoted to. Determined by the quote
 * currency (JPY pairs → 2, most others → 4). Pass `override` to force it.
 */
export function pipDecimals(pair: string, override?: number): number {
  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 0 || override > 10) {
      throw new RangeError(`pipDecimals override must be an integer 0–10, got ${override}`);
    }
    return override;
  }
  const { quote } = parsePair(pair);
  return QUOTE_PIP_DECIMALS[quote] ?? DEFAULT_PIP_DECIMALS;
}

/** The size of one pip for a pair, e.g. EUR/USD → 0.0001, USD/JPY → 0.01. */
export function pipSize(pair: string, override?: number): number {
  return 1 / 10 ** pipDecimals(pair, override);
}

function checkFinite(x: number, label: string): void {
  if (!Number.isFinite(x)) throw new RangeError(`${label} must be a finite number, got ${x}`);
}

function checkRate(rate: number, label: string): void {
  checkFinite(rate, label);
  if (rate <= 0) throw new RangeError(`${label} must be positive, got ${rate}`);
}

/**
 * Outright forward rate from spot and forward points.
 * `forward = spot + points × pipSize`.
 *
 * ```ts
 * outrightForward("EUR/USD", 1.0850, 25);   // 1.0875  (25 points = 0.0025)
 * outrightForward("USD/JPY", 156.20, -40);  // 155.80  (JPY pip = 0.01)
 * ```
 */
export function outrightForward(
  pair: string,
  spot: number,
  forwardPoints: number,
  pipDecimalsOverride?: number,
): number {
  checkRate(spot, "spot");
  checkFinite(forwardPoints, "forwardPoints");
  return spot + forwardPoints * pipSize(pair, pipDecimalsOverride);
}

/**
 * Forward points from spot and an outright forward:
 * `(forward − spot) / pipSize`.
 */
export function forwardPoints(
  pair: string,
  spot: number,
  outright: number,
  pipDecimalsOverride?: number,
): number {
  checkRate(spot, "spot");
  checkRate(outright, "outright");
  return (outright - spot) / pipSize(pair, pipDecimalsOverride);
}

/**
 * Derive a cross rate BASE/QUOTE from two rates that share a common currency
 * (typically USD). Handles all four leg orientations automatically.
 *
 * ```ts
 * // EUR/JPY from EUR/USD and USD/JPY:
 * crossRate("EUR/USD", 1.0850, "USD/JPY", 156.20); // 169.477
 * ```
 */
export function crossRate(
  pairA: string,
  rateA: number,
  pairB: string,
  rateB: number,
): number {
  const a = parsePair(pairA);
  const b = parsePair(pairB);
  checkRate(rateA, "rateA");
  checkRate(rateB, "rateB");

  // Identify the shared (pivot) currency and the two outer currencies.
  const shared = [a.base, a.quote].find((c) => c === b.base || c === b.quote);
  if (!shared) {
    throw new RangeError(`No common currency between ${pairA} and ${pairB}`);
  }
  // Express each pair as pivot→other or other→pivot, reducing to base/quote.
  // Value of A's non-shared currency in the shared currency:
  const aOther = a.base === shared ? a.quote : a.base;
  const bOther = b.base === shared ? b.quote : b.base;
  if (aOther === bOther) throw new RangeError(`${pairA} and ${pairB} describe the same pair`);

  // price of aOther in shared
  const aInShared = a.quote === shared ? rateA : 1 / rateA;
  // price of bOther in shared
  const bInShared = b.quote === shared ? rateB : 1 / rateB;

  // We want aOther/bOther = (price of aOther in shared) / (price of bOther in shared)
  return aInShared / bInShared;
}

/**
 * Triangular-arbitrage consistency check for three rates forming a loop
 * (e.g. EUR/USD, USD/JPY, EUR/JPY). Returns the implied cross, the quoted
 * cross, and whether they agree within `tolerancePips`.
 */
export interface TriangularCheck {
  impliedCross: number;
  quotedCross: number;
  differencePips: number;
  arbitrageFree: boolean;
}

export function triangularArbitrage(
  legAPair: string,
  legARate: number,
  legBPair: string,
  legBRate: number,
  crossPair: string,
  crossQuote: number,
  tolerancePips = 1,
): TriangularCheck {
  const impliedCross = crossRate(legAPair, legARate, legBPair, legBRate);
  checkRate(crossQuote, "crossQuote");
  const size = pipSize(crossPair);
  const differencePips = (crossQuote - impliedCross) / size;
  return {
    impliedCross,
    quotedCross: crossQuote,
    differencePips,
    arbitrageFree: Math.abs(differencePips) <= tolerancePips,
  };
}

/**
 * Value of one pip on a notional, expressed in the QUOTE currency.
 * `pipValueQuote("EUR/USD", 1_000_000)` → 100 (USD per pip).
 */
export function pipValueQuote(pair: string, notionalBase: number, pipDecimalsOverride?: number): number {
  checkFinite(notionalBase, "notionalBase");
  return notionalBase * pipSize(pair, pipDecimalsOverride);
}

/**
 * Value of one pip on a notional, expressed in the BASE currency, given the
 * current rate. `pipValueBase("EUR/USD", 1_000_000, 1.085)` ≈ 92.17.
 */
export function pipValueBase(
  pair: string,
  notionalBase: number,
  rate: number,
  pipDecimalsOverride?: number,
): number {
  checkRate(rate, "rate");
  return pipValueQuote(pair, notionalBase, pipDecimalsOverride) / rate;
}

/**
 * Split a rate into its big figure (the "handle") and pips. For EUR/USD
 * 1.08525 → `{ bigFigure: 1.08, pips: 52.5 }`.
 */
export interface RateParts {
  bigFigure: number;
  pips: number;
}

export function splitRate(pair: string, rate: number, pipDecimalsOverride?: number): RateParts {
  checkRate(rate, "rate");
  const dp = pipDecimals(pair, pipDecimalsOverride);
  const bigFigureUnit = 1 / 10 ** (dp - 2); // two digits above the pip
  const bigFigure = Math.floor(rate / bigFigureUnit) * bigFigureUnit;
  const pips = (rate - bigFigure) / pipSize(pair, pipDecimalsOverride);
  return { bigFigure: round(bigFigure, dp), pips: round(pips, 4) };
}

/** Round a rate to the pair's quoting precision. */
export function roundToPip(pair: string, rate: number, pipDecimalsOverride?: number): number {
  const dp = pipDecimals(pair, pipDecimalsOverride);
  return round(rate, dp);
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
