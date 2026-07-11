import { describe, expect, it } from "vitest";
import {
  crossRate,
  forwardPoints,
  outrightForward,
  parsePair,
  pipDecimals,
  pipSize,
  pipValueBase,
  pipValueQuote,
  roundToPip,
  splitRate,
  triangularArbitrage,
} from "../src/index.js";

describe("pair parsing and pip conventions", () => {
  it("parses BASE/QUOTE", () => {
    expect(parsePair("eur/usd")).toEqual({ base: "EUR", quote: "USD" });
    expect(() => parsePair("EURUSD")).toThrow(RangeError);
    expect(() => parsePair("USD/USD")).toThrow(RangeError);
  });

  it("pip decimals: 4 for most, 2 for JPY pairs", () => {
    expect(pipDecimals("EUR/USD")).toBe(4);
    expect(pipDecimals("USD/JPY")).toBe(2);
    expect(pipDecimals("EUR/JPY")).toBe(2);
    expect(pipSize("EUR/USD")).toBe(0.0001);
    expect(pipSize("USD/JPY")).toBe(0.01);
    expect(pipDecimals("EUR/USD", 5)).toBe(5); // override
  });
});

describe("forward points ↔ outright", () => {
  it("adds points scaled by the pip size", () => {
    expect(outrightForward("EUR/USD", 1.085, 25)).toBeCloseTo(1.0875, 10);
    expect(outrightForward("USD/JPY", 156.2, -40)).toBeCloseTo(155.8, 10);
  });

  it("recovers points from spot and outright", () => {
    expect(forwardPoints("EUR/USD", 1.085, 1.0875)).toBeCloseTo(25, 8);
    expect(forwardPoints("USD/JPY", 156.2, 155.8)).toBeCloseTo(-40, 8);
  });

  it("round-trips exactly", () => {
    for (const pts of [-120, -12.5, 0, 7, 250]) {
      const fwd = outrightForward("GBP/USD", 1.272, pts);
      expect(forwardPoints("GBP/USD", 1.272, fwd)).toBeCloseTo(pts, 8);
    }
  });
});

describe("cross rate", () => {
  it("EUR/JPY from EUR/USD and USD/JPY (shared = USD, mixed orientation)", () => {
    expect(crossRate("EUR/USD", 1.085, "USD/JPY", 156.2)).toBeCloseTo(1.085 * 156.2, 6);
  });

  it("handles shared currency as base of both legs", () => {
    // JPY/CHF from USD/JPY and USD/CHF: price of JPY in CHF
    const r = crossRate("USD/JPY", 156.2, "USD/CHF", 0.9);
    expect(r).toBeCloseTo((1 / 156.2) / (1 / 0.9), 10);
  });

  it("handles shared currency as quote of both legs", () => {
    // EUR/GBP from EUR/USD and GBP/USD
    const r = crossRate("EUR/USD", 1.085, "GBP/USD", 1.272);
    expect(r).toBeCloseTo(1.085 / 1.272, 10);
  });

  it("throws when there is no shared currency", () => {
    expect(() => crossRate("EUR/USD", 1.08, "GBP/JPY", 190)).toThrow(/common currency/);
  });
});

describe("triangular arbitrage", () => {
  it("flags a consistent triangle as arbitrage-free", () => {
    const cross = 1.085 * 156.2; // exactly the implied EUR/JPY
    const check = triangularArbitrage("EUR/USD", 1.085, "USD/JPY", 156.2, "EUR/JPY", cross);
    expect(check.arbitrageFree).toBe(true);
    expect(check.differencePips).toBeCloseTo(0, 6);
    expect(check.impliedCross).toBeCloseTo(cross, 8);
  });

  it("flags a mispriced cross beyond tolerance", () => {
    const implied = 1.085 * 156.2;
    const check = triangularArbitrage("EUR/USD", 1.085, "USD/JPY", 156.2, "EUR/JPY", implied + 0.5);
    expect(check.arbitrageFree).toBe(false);
    expect(check.differencePips).toBeCloseTo(50, 4); // 0.5 / 0.01 pip
  });
});

describe("pip value", () => {
  it("quote-currency pip value scales with notional", () => {
    expect(pipValueQuote("EUR/USD", 1_000_000)).toBeCloseTo(100, 10); // 100 USD/pip
    expect(pipValueQuote("USD/JPY", 1_000_000)).toBeCloseTo(10_000, 10); // 10,000 JPY/pip
  });

  it("base-currency pip value divides by the rate", () => {
    expect(pipValueBase("EUR/USD", 1_000_000, 1.085)).toBeCloseTo(100 / 1.085, 6);
  });
});

describe("big figure / pip split and rounding", () => {
  it("splits a rate into big figure and pips", () => {
    const parts = splitRate("EUR/USD", 1.08525);
    expect(parts.bigFigure).toBeCloseTo(1.08, 10);
    expect(parts.pips).toBeCloseTo(52.5, 6);
  });

  it("splits a JPY rate", () => {
    const parts = splitRate("USD/JPY", 156.235);
    expect(parts.bigFigure).toBeCloseTo(156, 10);
    expect(parts.pips).toBeCloseTo(23.5, 6);
  });

  it("rounds to the pair's precision", () => {
    expect(roundToPip("EUR/USD", 1.0852549)).toBe(1.0853);
    expect(roundToPip("USD/JPY", 156.237)).toBe(156.24);
  });
});

describe("validation", () => {
  it("rejects non-positive rates and non-finite inputs", () => {
    expect(() => outrightForward("EUR/USD", 0, 10)).toThrow(RangeError);
    expect(() => outrightForward("EUR/USD", 1.08, Number.NaN)).toThrow(RangeError);
    expect(() => forwardPoints("EUR/USD", 1.08, -1)).toThrow(RangeError);
    expect(() => pipDecimals("EUR/USD", -1)).toThrow(RangeError);
  });
});
