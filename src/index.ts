/**
 * fx-forward-math — FX quote and forward conventions math.
 *
 * The trading-desk arithmetic that consumer money libraries ignore: forward
 * points ↔ outright forwards with correct per-pair pip scaling, cross-rate
 * derivation, triangular-arbitrage checks, pip / big-figure handling, and pip
 * value, and covered-interest-parity forwards / implied yields with each
 * currency's money-market day-count basis. Pure functions, zero dependencies.
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

function check(cond: boolean, msg: string): void {
  if (!cond) throw new RangeError(msg);
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
  const outright = spot + forwardPoints * pipSize(pair, pipDecimalsOverride);
  if (outright <= 0) {
    throw new RangeError(`${forwardPoints} points on spot ${spot} give a non-positive outright`);
  }
  return outright;
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
  /** Cross implied by the two legs, oriented as `crossPair`. */
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
  const implied = crossRate(legAPair, legARate, legBPair, legBRate);
  checkRate(crossQuote, "crossQuote");
  check(Number.isFinite(tolerancePips) && tolerancePips >= 0, `tolerancePips must be ≥ 0`);
  // crossRate returns (A's non-shared currency)/(B's non-shared currency);
  // orient it to match the quoted cross pair.
  const a = parsePair(legAPair);
  const b = parsePair(legBPair);
  const shared = [a.base, a.quote].find((c) => c === b.base || c === b.quote)!;
  const aOther = a.base === shared ? a.quote : a.base;
  const bOther = b.base === shared ? b.quote : b.base;
  const cross = parsePair(crossPair);
  let impliedCross: number;
  if (cross.base === aOther && cross.quote === bOther) impliedCross = implied;
  else if (cross.base === bOther && cross.quote === aOther) impliedCross = 1 / implied;
  else {
    throw new RangeError(`${crossPair} is not the cross of ${legAPair} and ${legBPair} (${aOther}/${bOther})`);
  }
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
  // Work in pips, stripping binary noise first (1.13 / 0.01 = 112.99999…).
  const totalPips = round(rate * 10 ** dp, 4);
  const bigFigurePips = Math.floor(totalPips / 100) * 100; // two digits above the pip
  return {
    bigFigure: round(bigFigurePips / 10 ** dp, dp),
    pips: round(totalPips - bigFigurePips, 4),
  };
}

/**
 * Round a rate to the pair's quoting precision, half away from zero on the
 * decimal value (1.00005 → 1.0001, although 1.00005 × 10⁴ is 10000.4999… in
 * binary).
 */
export function roundToPip(pair: string, rate: number, pipDecimalsOverride?: number): number {
  checkRate(rate, "rate");
  const dp = pipDecimals(pair, pipDecimalsOverride);
  return round(rate, dp);
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  // toPrecision(15) drops the representation error of x × f before rounding.
  return Math.round(Number((x * f).toPrecision(15))) / f;
}

/** Money-market day-count basis: days in the year for ACT/360 or ACT/365F. */
export type DayBasis = 360 | 365;

/**
 * Day-count basis of each currency's overnight risk-free rate (SOFR, €STR,
 * SONIA, TONA, …), per OpenGamma Strata's overnight-index definitions.
 * These are also the bases of the currencies' OIS curves, which FX forwards
 * are priced off.
 */
const MONEY_MARKET_BASIS: Record<string, DayBasis> = {
  // ACT/360
  USD: 360, EUR: 360, CHF: 360, SEK: 360, DKK: 360, CZK: 360, CLP: 360, COP: 360,
  // ACT/365F
  GBP: 365, JPY: 365, AUD: 365, NZD: 365, CAD: 365, HKD: 365, SGD: 365, ZAR: 365,
  PLN: 365, HUF: 365, ILS: 365, INR: 365, IDR: 365, THB: 365, TRY: 365, RUB: 365, SAR: 365,
};

/**
 * Money-market day-count basis (360 or 365) for a currency: ACT/360 for USD,
 * EUR, CHF, SEK, DKK, …; ACT/365F for GBP, JPY, AUD, NZD, CAD, HKD, SGD, ZAR,
 * …. Throws for currencies without a listed convention (e.g. BRL, which is
 * BUS/252) — pass the basis explicitly instead.
 */
export function moneyMarketBasis(currency: string): DayBasis {
  const ccy = currency.trim().toUpperCase();
  const basis = MONEY_MARKET_BASIS[ccy];
  if (basis === undefined) {
    throw new RangeError(`No default money-market day-count basis for "${currency}"; pass it explicitly`);
  }
  return basis;
}

function resolveBasis(ccy: string, override: number | undefined, label: string): number {
  if (override === undefined) return moneyMarketBasis(ccy);
  check(override === 360 || override === 365, `${label} must be 360 or 365, got ${override}`);
  return override;
}

function checkDays(days: number): void {
  check(Number.isFinite(days) && days > 0, `days must be positive, got ${days}`);
}

function checkMmRate(r: number, label: string): void {
  checkFinite(r, label);
  check(r > -1, `${label} must be a decimal > -1 (0.05 = 5%), got ${r}`);
}

/** Inputs shared by the covered-interest-parity functions. */
export interface CipBase {
  /** Currency pair, "BASE/QUOTE". */
  pair: string;
  /** Spot rate (QUOTE per BASE). */
  spot: number;
  /** Calendar days from the spot date to the forward value date. */
  days: number;
  /** Day-count basis of the base currency's rate. Default {@link moneyMarketBasis}. */
  baseBasis?: DayBasis;
  /** Day-count basis of the quote currency's rate. Default {@link moneyMarketBasis}. */
  quoteBasis?: DayBasis;
}

export interface CipParams extends CipBase {
  /** Base-currency simple money-market rate, decimal (0.0525 = 5.25%). */
  baseRate: number;
  /** Quote-currency simple money-market rate, decimal. */
  quoteRate: number;
}

/**
 * Outright forward implied by covered interest parity, with simple
 * money-market interest in each currency on its own day-count basis:
 * `forward = spot × (1 + quoteRate × days/quoteBasis) / (1 + baseRate × days/baseBasis)`.
 *
 * ```ts
 * // EUR/USD 1.0850, 3M (92 days), EUR 2.00% (ACT/360), USD 4.30% (ACT/360)
 * impliedForward({ pair: "EUR/USD", spot: 1.085, days: 92, baseRate: 0.02, quoteRate: 0.043 });
 * // 1.091345…
 * ```
 */
export function impliedForward(p: CipParams): number {
  const { base, quote } = parsePair(p.pair);
  checkRate(p.spot, "spot");
  checkDays(p.days);
  checkMmRate(p.baseRate, "baseRate");
  checkMmRate(p.quoteRate, "quoteRate");
  const bb = resolveBasis(base, p.baseBasis, "baseBasis");
  const qb = resolveBasis(quote, p.quoteBasis, "quoteBasis");
  return (p.spot * (1 + p.quoteRate * (p.days / qb))) / (1 + p.baseRate * (p.days / bb));
}

/** Forward points implied by covered interest parity: `(impliedForward − spot) / pipSize`. */
export function impliedForwardPoints(p: CipParams, pipDecimalsOverride?: number): number {
  return (impliedForward(p) - p.spot) / pipSize(p.pair, pipDecimalsOverride);
}

/**
 * Quote-currency rate implied by spot, outright forward and the base-currency
 * rate (the FX-swap "implied yield"), decimal on the quote basis:
 * `((forward/spot) × (1 + baseRate × days/baseBasis) − 1) × quoteBasis/days`.
 */
export function impliedQuoteRate(p: CipBase & { forward: number; baseRate: number }): number {
  const { base, quote } = parsePair(p.pair);
  checkRate(p.spot, "spot");
  checkRate(p.forward, "forward");
  checkDays(p.days);
  checkMmRate(p.baseRate, "baseRate");
  const bb = resolveBasis(base, p.baseBasis, "baseBasis");
  const qb = resolveBasis(quote, p.quoteBasis, "quoteBasis");
  return ((p.forward / p.spot) * (1 + p.baseRate * (p.days / bb)) - 1) * (qb / p.days);
}

/**
 * Base-currency rate implied by spot, outright forward and the quote-currency
 * rate, decimal on the base basis:
 * `((spot/forward) × (1 + quoteRate × days/quoteBasis) − 1) × baseBasis/days`.
 */
export function impliedBaseRate(p: CipBase & { forward: number; quoteRate: number }): number {
  const { base, quote } = parsePair(p.pair);
  checkRate(p.spot, "spot");
  checkRate(p.forward, "forward");
  checkDays(p.days);
  checkMmRate(p.quoteRate, "quoteRate");
  const bb = resolveBasis(base, p.baseBasis, "baseBasis");
  const qb = resolveBasis(quote, p.quoteBasis, "quoteBasis");
  return ((p.spot / p.forward) * (1 + p.quoteRate * (p.days / qb)) - 1) * (bb / p.days);
}
