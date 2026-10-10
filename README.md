# fx-forward-math

FX **trading conventions** math — forward points ↔ outright forwards, covered-interest-parity forwards and implied yields (per-currency ACT/360 vs ACT/365F), cross-rate derivation, triangular-arbitrage checks, pip / big-figure handling, and pip value. Zero dependencies.

```
npm install fx-forward-math
```

## Why

`currency.js` and `dinero.js` handle *consumer* money — formatting and allocation. Neither knows what a **pip** is, how to turn **forward points** into an outright, or how to derive a **cross rate**. That's the arithmetic an FX desk actually uses, and npm had no library for it.

```ts
import { outrightForward, crossRate, triangularArbitrage } from "fx-forward-math";

// 25 forward points on EUR/USD (pip = 0.0001):
outrightForward("EUR/USD", 1.0850, 25);    // 1.0875
// −40 points on USD/JPY (pip = 0.01):
outrightForward("USD/JPY", 156.20, -40);   // 155.80

// EUR/JPY implied from the two USD legs:
crossRate("EUR/USD", 1.0850, "USD/JPY", 156.20);  // 169.477

triangularArbitrage("EUR/USD", 1.0850, "USD/JPY", 156.20, "EUR/JPY", 169.60);
// { impliedCross: 169.477, differencePips: 12.3, arbitrageFree: false }

// Covered interest parity: 3M (92 days) EUR/USD, EUR 2.00%, USD 4.30% (both ACT/360)
impliedForward({ pair: "EUR/USD", spot: 1.0850, days: 92, baseRate: 0.02, quoteRate: 0.043 }); // 1.091345
impliedForwardPoints({ pair: "EUR/USD", spot: 1.0850, days: 92, baseRate: 0.02, quoteRate: 0.043 }); // 63.45
```

## API

Pairs are `"BASE/QUOTE"`; the rate is how many QUOTE units one BASE unit buys. Pip size is inferred from the quote currency (JPY-quoted pairs → 0.01, most others → 0.0001) and overridable everywhere.

- **`outrightForward(pair, spot, forwardPoints)`** / **`forwardPoints(pair, spot, outright)`** — convert both ways.
- **`impliedForward({ pair, spot, days, baseRate, quoteRate, baseBasis?, quoteBasis? })`** — covered interest parity with simple money-market interest: `spot × (1 + r_quote × days/B_quote) / (1 + r_base × days/B_base)`. Rates are decimals (`0.043` = 4.30%), `days` are calendar days from spot to the forward value date. **`impliedForwardPoints(params)`** gives the same in points.
- **`impliedQuoteRate({ pair, spot, forward, days, baseRate, … })`** / **`impliedBaseRate({ …, quoteRate })`** — the FX-implied yield of one currency given the other's rate.
- **`moneyMarketBasis(currency)`** — the default day-count basis: the basis of the currency's overnight risk-free rate (as in OpenGamma Strata). ACT/360: USD, EUR, CHF, SEK, DKK, CZK, CLP, COP. ACT/365F: GBP, JPY, AUD, NZD, CAD, HKD, SGD, ZAR, PLN, HUF, ILS, INR, IDR, THB, TRY, RUB, SAR. Other currencies throw — pass `baseBasis` / `quoteBasis` (360 or 365); BUS/252 (BRL) is not supported.
- **`crossRate(pairA, rateA, pairB, rateB)`** — derive the cross from two legs sharing a currency; returns the rate of *A's non-shared currency / B's non-shared currency* (any leg orientation).
- **`triangularArbitrage(legA, rA, legB, rB, crossPair, crossQuote, tolerancePips?)`** — implied vs quoted cross (the implied cross is oriented to `crossPair`, which must be formed by the two legs' outer currencies) and whether they agree.
- **`pipValueQuote(pair, notional)`** / **`pipValueBase(pair, notional, rate)`** — value of one pip.
- **`splitRate(pair, rate)`** → `{ bigFigure, pips }` (pips to 4 dp); **`roundToPip(pair, rate)`** (half-up on the decimal value, so `1.00005` → `1.0001`); **`pipSize`**, **`pipDecimals`**, **`parsePair`**.

All rates must be positive and finite, else `RangeError`.

Pip conventions for exotic quote currencies vary by venue (e.g. USD/IDR and USD/KRW forward points are often quoted in whole units); the built-in table covers JPY, KRW, CLP, HUF, IDR and TWD at 2 decimals and everything else at 4 — pass the `pipDecimals` override where your market differs.

## Related

Pairs with [`fx-value-date`](https://github.com/moshejs/fx-value-date) (settlement dates). Part of a fixed-income & markets toolkit: [`32nds`](https://github.com/moshejs/32nds) · [`day-count`](https://github.com/moshejs/day-count) · [`newyorkfed`](https://github.com/moshejs/newyorkfed) · [`instrument-identifiers`](https://github.com/moshejs/instrument-identifiers).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
