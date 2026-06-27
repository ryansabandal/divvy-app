// Net balance for one participant: positive = owed money, negative = owes money
export interface ParticipantBalance {
  participantId: string;
  balance: number;
}

export interface Settlement {
  from_id: string; // who owes
  to_id: string; // who is owed
  amount: number;
}

// Greedy debt simplification: repeatedly match the largest creditor with the largest
// debtor so the group ends up with the fewest possible number of payments
export function computeSettlements(balances: ParticipantBalance[]): Settlement[] {
  // Ignore anyone already settled (within a cent, to absorb rounding) and work on copies
  const creditors = balances
    .filter((b) => b.balance > 0.01)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.balance - a.balance);
  const debtors = balances
    .filter((b) => b.balance < -0.01)
    .map((b) => ({ participantId: b.participantId, balance: -b.balance })) // store as a positive amount owed
    .sort((a, b) => b.balance - a.balance);

  const settlements: Settlement[] = [];
  let i = 0;
  let j = 0;

  while (i < creditors.length && j < debtors.length) {
    const creditor = creditors[i];
    const debtor = debtors[j];
    const amount = Math.round(Math.min(creditor.balance, debtor.balance) * 100) / 100;

    settlements.push({ from_id: debtor.participantId, to_id: creditor.participantId, amount });

    creditor.balance -= amount;
    debtor.balance -= amount;

    // Whichever side just hit zero (or both) moves on to the next person
    if (creditor.balance <= 0.01) i++;
    if (debtor.balance <= 0.01) j++;
  }

  return settlements;
}
