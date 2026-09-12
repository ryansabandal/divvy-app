import { describe, it, expect } from "vitest";
import { buildParticipantBreakdown, type BreakdownExpense } from "./expenseBreakdown";

const ryan = { id: "ryan", name: "Ryan" };

// Builds one expense row in the shape buildParticipantBreakdown reads
function expense(over: Partial<BreakdownExpense> & Pick<BreakdownExpense, "splits">): BreakdownExpense {
  return {
    id: "e1",
    description: "Koobedeh",
    amount: 260,
    payer: ryan,
    quantity: null,
    ...over,
  };
}

// Asserted as whole arrays rather than by index: tsconfig sets noUncheckedIndexedAccess,
// so charges[0] is possibly-undefined and every assertion would need a guard.
describe("buildParticipantBreakdown units gating", () => {
  it("drops units on a quantity-1 split, where ×1 would just restate the amount", () => {
    const { charges } = buildParticipantBreakdown("myka", [
      expense({ quantity: 1, splits: [{ participant_id: "myka", amount_owed: 260, units: 1 }] }),
    ]);
    expect(charges).toEqual([
      // amountOwed is untouched — only the units annotation is suppressed
      { expenseId: "e1", description: "Koobedeh", amountOwed: 260, units: null, payerName: "Ryan" },
    ]);
  });

  it("keeps units on a real multi-unit split, including a single-unit consumer", () => {
    const multiUnit = expense({
      amount: 90,
      quantity: 6,
      splits: [
        { participant_id: "ryan", amount_owed: 15, units: 1 },
        { participant_id: "myka", amount_owed: 75, units: 5 },
      ],
    });
    // ×1 is meaningful here — it sits next to Myka's ×5
    expect(buildParticipantBreakdown("ryan", [multiUnit]).charges).toEqual([
      { expenseId: "e1", description: "Koobedeh", amountOwed: 15, units: 1, payerName: "Ryan" },
    ]);
    expect(buildParticipantBreakdown("myka", [multiUnit]).charges).toEqual([
      { expenseId: "e1", description: "Koobedeh", amountOwed: 75, units: 5, payerName: "Ryan" },
    ]);
  });

  it("leaves EVEN and CUSTOM charges with null units", () => {
    const { charges } = buildParticipantBreakdown("myka", [
      expense({
        amount: 100,
        splits: [
          { participant_id: "ryan", amount_owed: 50, units: null },
          { participant_id: "myka", amount_owed: 50, units: null },
        ],
      }),
    ]);
    expect(charges).toEqual([
      { expenseId: "e1", description: "Koobedeh", amountOwed: 50, units: null, payerName: "Ryan" },
    ]);
  });

  it("still nets a payer's own charge against what they fronted", () => {
    const { charges, totalCharged, totalPaid, netOwed } = buildParticipantBreakdown("ryan", [
      expense({ quantity: 1, splits: [{ participant_id: "myka", amount_owed: 260, units: 1 }] }),
    ]);
    // Ryan fronted 260 and is charged for none of it, so he's owed the full amount back
    expect(charges).toEqual([]);
    expect(totalCharged).toBe(0);
    expect(totalPaid).toBe(260);
    expect(netOwed).toBe(-260);
  });
});
