import { describe, it, expect } from "vitest";
import { deriveSessionPayer, deriveDefaultPayer, type PayerExpense } from "./sessionPayer";

const ana = { id: "ana", name: "Ana" };
const ben = { id: "ben", name: "Ben" };

describe("deriveSessionPayer", () => {
  it("returns null for zero expenses", () => {
    expect(deriveSessionPayer([])).toBeNull();
  });

  it("returns the shared payer when every expense agrees", () => {
    const expenses: PayerExpense[] = [{ payer: ana }, { payer: ana }, { payer: ana }];
    expect(deriveSessionPayer(expenses)).toEqual(ana);
  });

  it("returns null the moment payers disagree", () => {
    const expenses: PayerExpense[] = [{ payer: ana }, { payer: ana }, { payer: ben }];
    expect(deriveSessionPayer(expenses)).toBeNull();
  });
});

describe("deriveDefaultPayer", () => {
  it("returns null for zero expenses", () => {
    expect(deriveDefaultPayer([])).toBeNull();
  });

  it("returns the payer when there's only one", () => {
    const expenses: PayerExpense[] = [{ payer: ana }];
    expect(deriveDefaultPayer(expenses)).toBe("ana");
  });

  it("stays on the majority payer despite one override, rather than snapping to participant #1", () => {
    // 3 expenses by Ana, 1 override by Ben — the default must remain Ana, not fall back to
    // whichever participant happens to be first in the session's participant list
    const expenses: PayerExpense[] = [{ payer: ana }, { payer: ana }, { payer: ben }, { payer: ana }];
    expect(deriveDefaultPayer(expenses)).toBe("ana");
  });

  it("breaks a tie toward the most recently paid (last in sort_order)", () => {
    const expenses: PayerExpense[] = [{ payer: ana }, { payer: ben }];
    expect(deriveDefaultPayer(expenses)).toBe("ben");
  });

  it("prefers frequency over recency when they disagree", () => {
    // Ana has the most expenses (2 vs 1), but Ben's is the most recent — this isolates the two
    // signals from each other, since every other test above has them agree on the same winner
    const expenses: PayerExpense[] = [{ payer: ana }, { payer: ana }, { payer: ben }];
    expect(deriveDefaultPayer(expenses)).toBe("ana");
  });
});
