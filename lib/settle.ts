// Net balance for one participant: positive = owed money, negative = owes money
export interface ParticipantBalance {
  participantId: string;
  balance: number;
}

// One payment in a simplified plan. Named distinctly from lib/types.ts's Settlement (the
// persisted/API-facing shape, with id/names/paid) to avoid two same-named, differently-shaped
// types across the codebase.
export interface SettlementTransfer {
  from_id: string; // who owes
  to_id: string; // who is owed
  amount: number;
}

// Half a centavo: small enough that a genuine 1-centavo balance is never mistaken for
// settled, large enough to absorb floating-point noise from repeated +=/-= on amounts
// that are already rounded to the cent. sessions.ts's CUSTOM-split guard reuses this
// same threshold so "close enough to zero" means one thing across the whole app.
export const RECONCILED_EPSILON = 0.005;

// Greedy debt simplification: repeatedly match the largest creditor with the largest
// debtor so the group ends up with the fewest possible number of payments
export function computeSettlements(balances: ParticipantBalance[]): SettlementTransfer[] {
  // Ignore anyone already settled (within RECONCILED_EPSILON, to absorb float noise) and work on copies
  const creditors = balances
    .filter((b) => b.balance > RECONCILED_EPSILON)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.balance - a.balance);
  const debtors = balances
    .filter((b) => b.balance < -RECONCILED_EPSILON)
    .map((b) => ({ participantId: b.participantId, balance: -b.balance })) // store as a positive amount owed
    .sort((a, b) => b.balance - a.balance);

  const settlements: SettlementTransfer[] = [];
  let i = 0;
  let j = 0;

  // A NaN balance (e.g. from an Infinity - Infinity upstream) satisfies neither `<=` comparison
  // below, so neither index would ever advance without this bound — load-bearing, not defence in
  // depth. The loop can never need more than one settlement per remaining creditor+debtor.
  const maxIterations = creditors.length + debtors.length;
  let iterations = 0;

  while (i < creditors.length && j < debtors.length && iterations < maxIterations) {
    iterations++;
    // Safe: the while guard above already bounds both indices
    const creditor = creditors[i]!;
    const debtor = debtors[j]!;
    const amount = Math.round(Math.min(creditor.balance, debtor.balance) * 100) / 100;

    settlements.push({ from_id: debtor.participantId, to_id: creditor.participantId, amount });

    creditor.balance -= amount;
    debtor.balance -= amount;

    // Whichever side just hit zero (or both) moves on to the next person
    if (creditor.balance <= RECONCILED_EPSILON) i++;
    if (debtor.balance <= RECONCILED_EPSILON) j++;
  }

  return settlements;
}
