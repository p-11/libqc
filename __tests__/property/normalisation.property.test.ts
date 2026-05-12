import fc from 'fast-check';

import type { BalanceBigInt, Decimals } from '../../src/types';
import { normaliseBalance } from '../../src/assets';
import { InvalidAssetDecimalsError } from '../../src/errors';
import { arbBalanceBigInt, arbDecimals } from './arbitraries';

const NUM_RUNS = Number(process.env.PROPERTY_NUM_RUNS ?? 200);

// ---------------------------------------------------------------------------
// Identity: normalise(x, d, d) === x
// ---------------------------------------------------------------------------
describe('normaliseBalance – identity', () => {
  it('returns the original value when source === target decimals', () => {
    fc.assert(
      fc.property(arbBalanceBigInt, arbDecimals, (amount, decimals) => {
        const result = normaliseBalance(
          amount as BalanceBigInt,
          decimals as Decimals,
          decimals as Decimals
        );
        expect(result).toBe(amount);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Round-trip: scale up then down recovers the original (lossless direction)
// ---------------------------------------------------------------------------
describe('normaliseBalance – round-trip', () => {
  it('up then down returns the original when target >= source', () => {
    fc.assert(
      fc.property(
        arbBalanceBigInt,
        arbDecimals,
        arbDecimals,
        (amount, d1, d2) => {
          const lo = Math.min(d1, d2) as Decimals;
          const hi = Math.max(d1, d2) as Decimals;

          const up = normaliseBalance(amount as BalanceBigInt, lo, hi);
          const back = normaliseBalance(up, hi, lo);
          expect(back).toBe(amount);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Non-negative: output >= 0 for non-negative input
// ---------------------------------------------------------------------------
describe('normaliseBalance – non-negative', () => {
  it('never produces a negative result for non-negative input', () => {
    fc.assert(
      fc.property(
        arbBalanceBigInt,
        arbDecimals,
        arbDecimals,
        (amount, src, tgt) => {
          const result = normaliseBalance(
            amount as BalanceBigInt,
            src as Decimals,
            tgt as Decimals
          );
          expect(result).toBeGreaterThanOrEqual(0n);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Monotonicity: if x > y then normalise(x) >= normalise(y)
// ---------------------------------------------------------------------------
describe('normaliseBalance – monotonicity', () => {
  it('preserves ordering: larger input produces >= output', () => {
    fc.assert(
      fc.property(
        arbBalanceBigInt,
        arbBalanceBigInt,
        arbDecimals,
        arbDecimals,
        (a, b, src, tgt) => {
          const lo = a < b ? a : b;
          const hi = a < b ? b : a;

          const rLo = normaliseBalance(
            lo as BalanceBigInt,
            src as Decimals,
            tgt as Decimals
          );
          const rHi = normaliseBalance(
            hi as BalanceBigInt,
            src as Decimals,
            tgt as Decimals
          );
          expect(rHi).toBeGreaterThanOrEqual(rLo);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Transitivity: a→b→c equals a→c when only scaling up
// ---------------------------------------------------------------------------
describe('normaliseBalance – transitivity (scale-up only)', () => {
  it('chained up-scaling equals direct up-scaling', () => {
    fc.assert(
      fc.property(
        arbBalanceBigInt,
        // three decimals sorted ascending
        fc
          .tuple(arbDecimals, arbDecimals, arbDecimals)
          .map(ds => [...ds].sort((a, b) => a - b) as [number, number, number]),
        (amount, [d1, d2, d3]) => {
          const direct = normaliseBalance(
            amount as BalanceBigInt,
            d1 as Decimals,
            d3 as Decimals
          );
          const step1 = normaliseBalance(
            amount as BalanceBigInt,
            d1 as Decimals,
            d2 as Decimals
          );
          const step2 = normaliseBalance(step1, d2 as Decimals, d3 as Decimals);
          expect(step2).toBe(direct);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Invalid decimals: negative or non-integer decimals always throw
// ---------------------------------------------------------------------------
describe('normaliseBalance – invalid decimals', () => {
  const arbNegativeDecimal = fc.integer({ min: -100, max: -1 });
  const arbNonIntegerDecimal = fc
    .integer({ min: 0, max: 100 })
    .map(n => n + 0.5);

  it('throws for negative source decimals', () => {
    fc.assert(
      fc.property(
        arbBalanceBigInt,
        arbNegativeDecimal,
        arbDecimals,
        (amount, src, tgt) => {
          expect(() =>
            normaliseBalance(
              amount as BalanceBigInt,
              src as Decimals,
              tgt as Decimals
            )
          ).toThrow(InvalidAssetDecimalsError);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('throws for negative target decimals', () => {
    fc.assert(
      fc.property(
        arbBalanceBigInt,
        arbDecimals,
        arbNegativeDecimal,
        (amount, src, tgt) => {
          expect(() =>
            normaliseBalance(
              amount as BalanceBigInt,
              src as Decimals,
              tgt as Decimals
            )
          ).toThrow(InvalidAssetDecimalsError);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('throws for non-integer source decimals', () => {
    fc.assert(
      fc.property(
        arbBalanceBigInt,
        arbNonIntegerDecimal,
        arbDecimals,
        (amount, src, tgt) => {
          expect(() =>
            normaliseBalance(
              amount as BalanceBigInt,
              src as Decimals,
              tgt as Decimals
            )
          ).toThrow(InvalidAssetDecimalsError);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('throws for non-integer target decimals', () => {
    fc.assert(
      fc.property(
        arbBalanceBigInt,
        arbDecimals,
        arbNonIntegerDecimal,
        (amount, src, tgt) => {
          expect(() =>
            normaliseBalance(
              amount as BalanceBigInt,
              src as Decimals,
              tgt as Decimals
            )
          ).toThrow(InvalidAssetDecimalsError);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
