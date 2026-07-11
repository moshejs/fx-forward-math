# fx-forward-math

FX **trading conventions** math — forward points ↔ outright forwards, cross-rate derivation, triangular-arbitrage checks, pip / big-figure handling, and pip value. Zero dependencies.

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
```

## API

Pairs are `"BASE/QUOTE"`; the rate is how many QUOTE units one BASE unit buys. Pip size is inferred from the quote currency (JPY-quoted pairs → 0.01, most others → 0.0001) and overridable everywhere.

- **`outrightForward(pair, spot, forwardPoints)`** / **`forwardPoints(pair, spot, outright)`** — convert both ways.
- **`crossRate(pairA, rateA, pairB, rateB)`** — derive the cross from two legs sharing a currency; returns the rate of *A's non-shared currency / B's non-shared currency* (any leg orientation).
- **`triangularArbitrage(legA, rA, legB, rB, crossPair, crossQuote, tolerancePips?)`** — implied vs quoted cross and whether they agree.
- **`pipValueQuote(pair, notional)`** / **`pipValueBase(pair, notional, rate)`** — value of one pip.
- **`splitRate(pair, rate)`** → `{ bigFigure, pips }`; **`roundToPip(pair, rate)`**; **`pipSize`**, **`pipDecimals`**, **`parsePair`**.

All rates must be positive and finite, else `RangeError`.

## Related

Pairs with [`fx-value-date`](https://github.com/moshejs/fx-value-date) (settlement dates). Part of a fixed-income & markets toolkit: [`32nds`](https://github.com/moshejs/32nds) · [`day-count`](https://github.com/moshejs/day-count) · [`newyorkfed`](https://github.com/moshejs/newyorkfed) · [`instrument-identifiers`](https://github.com/moshejs/instrument-identifiers).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
