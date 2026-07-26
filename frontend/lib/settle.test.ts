import { describe, it, expect } from "vitest";
import { computeSettlements, RECONCILED_EPSILON, type ParticipantBalance } from "./settle";

// Sums a plan's amounts per participant so tests can assert the whole plan reconciles —
// every creditor ends up receiving their full credit, every debtor paying their full debt.
function netFromSettlements(settlements: { from_id: string; to_id: string; amount: number }[]) {
  const net = new Map<string, number>();
  for (const s of settlements) {
    net.set(s.to_id, (net.get(s.to_id) ?? 0) + s.amount);
    net.set(s.from_id, (net.get(s.from_id) ?? 0) - s.amount);
  }
  return net;
}

describe("computeSettlements", () => {
  it("returns an empty plan for no participants", () => {
    expect(computeSettlements([])).toEqual([]);
  });

  it("returns an empty plan when everyone is already settled", () => {
    const balances: ParticipantBalance[] = [
      { participantId: "A", balance: 0 },
      { participantId: "B", balance: 0 },
    ];
    expect(computeSettlements(balances)).toEqual([]);
  });

  it("matches a single creditor to a single debtor for the exact amount", () => {
    const balances: ParticipantBalance[] = [
      { participantId: "A", balance: 50 },
      { participantId: "B", balance: -50 },
    ];
    expect(computeSettlements(balances)).toEqual([{ from_id: "B", to_id: "A", amount: 50 }]);
  });

  it("reconciles an uneven 3-way split with no residual", () => {
    // A paid 100, shared 33.34/33.33/33.33 — sessions.ts's remainder-push already makes
    // these sum to exactly zero before computeSettlements ever sees them
    const balances: ParticipantBalance[] = [
      { participantId: "A", balance: 66.66 },
      { participantId: "B", balance: -33.33 },
      { participantId: "C", balance: -33.33 },
    ];
    const net = netFromSettlements(computeSettlements(balances));
    expect(net.get("A")).toBeCloseTo(66.66, 2);
    expect(net.get("B")).toBeCloseTo(-33.33, 2);
    expect(net.get("C")).toBeCloseTo(-33.33, 2);
  });

  it("greedily matches largest creditor/debtor first, minimizing transaction count", () => {
    const balances: ParticipantBalance[] = [
      { participantId: "A", balance: 60 },
      { participantId: "B", balance: 40 },
      { participantId: "C", balance: -70 },
      { participantId: "D", balance: -30 },
    ];
    const plan = computeSettlements(balances);
    expect(plan[0]).toEqual({ from_id: "C", to_id: "A", amount: 60 });
    expect(plan).toHaveLength(3);
    const net = netFromSettlements(plan);
    expect(net.get("A")).toBeCloseTo(60, 2);
    expect(net.get("B")).toBeCloseTo(40, 2);
    expect(net.get("C")).toBeCloseTo(-70, 2);
    expect(net.get("D")).toBeCloseTo(-30, 2);
  });

  // Regression coverage for the audit finding: a genuine one-centavo balance used to be
  // filtered out entirely (the old 0.01 threshold excluded exactly -0.01), stranding the
  // creditor's money with an empty plan. RECONCILED_EPSILON = 0.005 fixes this.
  it("reconciles a real one-centavo-per-person balance instead of stranding it (audit regression)", () => {
    // A paid 0.02, split EVEN between B and C only
    const balances: ParticipantBalance[] = [
      { participantId: "A", balance: 0.02 },
      { participantId: "B", balance: -0.01 },
      { participantId: "C", balance: -0.01 },
    ];
    const net = netFromSettlements(computeSettlements(balances));
    expect(net.get("A")).toBeCloseTo(0.02, 2);
    expect(net.get("B")).toBeCloseTo(-0.01, 2);
    expect(net.get("C")).toBeCloseTo(-0.01, 2);
  });

  it("reconciles the asymmetric sub-centavo variant (audit regression)", () => {
    const balances: ParticipantBalance[] = [
      { participantId: "A", balance: 0.03 },
      { participantId: "B", balance: -0.02 },
      { participantId: "C", balance: -0.01 },
    ];
    const net = netFromSettlements(computeSettlements(balances));
    expect(net.get("A")).toBeCloseTo(0.03, 2);
    expect(net.get("B")).toBeCloseTo(-0.02, 2);
    expect(net.get("C")).toBeCloseTo(-0.01, 2);
  });

  it("still treats a balance within RECONCILED_EPSILON of zero as settled", () => {
    const balances: ParticipantBalance[] = [
      { participantId: "A", balance: RECONCILED_EPSILON / 2 },
      { participantId: "B", balance: -RECONCILED_EPSILON / 2 },
    ];
    expect(computeSettlements(balances)).toEqual([]);
  });
});
