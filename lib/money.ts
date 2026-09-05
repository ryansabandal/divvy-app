// Rounds to the nearest centavo. The running sums this feeds are additions of already-rounded
// amounts, so without this they pick up float noise (e.g. 175.00000000000003) and render a
// misleading figure.
export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// Splits a whole-centavo total into one integer-centavo share per weight, proportional to the
// weights. Largest-remainder apportionment: floor every exact share, then hand the leftover
// centavos to the entries that lost the most to that floor. Given non-negative weights that
// add up to more than zero, no share lands more than one centavo below its exact value and the
// shares sum back to totalCents exactly; a total weight of zero charges nobody instead.
export function distributeCents(totalCents: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  // No weight to divide by — nobody is charged anything
  if (totalWeight <= 0) return weights.map(() => 0);

  // Each share floored to a whole centavo, alongside what the floor discarded — kept as an
  // exact integer numerator rather than a fraction, so the ranking below never sees float noise
  const shares = weights.map((w, index) => ({
    index,
    floor: Math.floor((totalCents * w) / totalWeight),
    shortfall: (totalCents * w) % totalWeight,
  }));

  // Largest shortfall first, ties going to the earlier participant so the order is deterministic
  shares.sort((a, b) => b.shortfall - a.shortfall || a.index - b.index);

  // The centavos the flooring left unallocated, one each to the front of that ranking
  const leftover = totalCents - shares.reduce((sum, s) => sum + s.floor, 0);

  return shares
    .map((s, rank) => ({ index: s.index, cents: s.floor + (rank < leftover ? 1 : 0) }))
    .sort((a, b) => a.index - b.index)
    .map((s) => s.cents);
}
