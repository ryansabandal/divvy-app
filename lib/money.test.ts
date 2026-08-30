import { describe, it, expect } from "vitest";
import { distributeCents } from "./money";

describe("distributeCents", () => {
  it("gives the leftover centavo to the first of three equal shares", () => {
    // 100.00 split three ways — 33.333...c each, one centavo left over
    expect(distributeCents(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
  });

  it("spreads the leftover centavos over many equal shares", () => {
    // 1.00 across 18 people: 5.55c each, ten centavos left over
    const shares = distributeCents(100, Array(18).fill(1));
    expect(shares).toEqual([...Array(10).fill(6), ...Array(8).fill(5)]);
    expect(shares.reduce((sum, s) => sum + s, 0)).toBe(100);
  });

  it("weights each share by how many units that participant consumed", () => {
    // 1.70 over 20 units taken 7/6/4/3 — exact shares are 59.5c, 51c, 34c, 25.5c
    expect(distributeCents(170, [7, 6, 4, 3])).toEqual([60, 51, 34, 25]);
    // 100.00 over 6 shots taken 4/2 — divides cleanly, so nothing is left over
    expect(distributeCents(10000, [4, 2])).toEqual([6667, 3333]);
  });

  it("spreads the leftover centavos over many equal units", () => {
    // 1.70 over 20 units taken one each: 8.5c per unit, ten centavos left over
    expect(distributeCents(170, Array(20).fill(1))).toEqual([
      ...Array(10).fill(9),
      ...Array(10).fill(8),
    ]);
  });

  it("settles a shortfall tie by participant order", () => {
    // Weights 1 and 3 of 10c: exact shares 2.5c and 7.5c lose the same to the floor, so the
    // earlier participant takes the leftover centavo
    expect(distributeCents(10, [1, 3])).toEqual([3, 7]);
    // Weights 1 and 2 of 10c: exact shares 3.33c and 6.67c, and the larger shortfall wins outright
    expect(distributeCents(10, [1, 2])).toEqual([3, 7]);
  });

  it("charges nobody when there is no weight to divide by", () => {
    expect(distributeCents(100, [0, 0])).toEqual([0, 0]);
    expect(distributeCents(100, [])).toEqual([]);
  });

  it("never produces a negative share and always sums exactly", () => {
    // Three weight shapes across small, rounding-prone totals: an even split, a ramp, and one
    // heavy consumer against a row of single units
    const shapes = (n: number) => [
      { label: "equal", weights: Array(n).fill(1) },
      { label: "ramp", weights: Array.from({ length: n }, (_, i) => i + 1) },
      { label: "one-heavy", weights: Array.from({ length: n }, (_, i) => (i === 0 ? n * 3 : 1)) },
    ];

    for (let n = 1; n <= 50; n++) {
      for (let totalCents = 1; totalCents <= 300; totalCents++) {
        for (const { label, weights } of shapes(n)) {
          const shares = distributeCents(totalCents, weights);
          // Assert on the offending values, so a failure names the bad case instead of "false"
          const context = { label, n, totalCents };
          expect({ ...context, negative: shares.filter((s) => s < 0) }).toEqual({
            ...context,
            negative: [],
          });
          expect({ ...context, sum: shares.reduce((sum, s) => sum + s, 0) }).toEqual({
            ...context,
            sum: totalCents,
          });
        }
      }
    }
  });
});
