// Shared by the settle and read-only view pages so "what is this person actually being charged
// for" is computed in exactly one place. Pure — no fetching, no React — so it stays easy to reason about.

// Minimal shape this module needs from an expense. Declared structurally (rather than importing a
// page's interface) so each page's richer local type satisfies it without any casting — the same
// approach computeNetBalances uses on the backend.
export interface BreakdownExpense {
  id: string;
  description: string;
  amount: number;
  payer: { id: string; name: string };
  splits: { participant_id: string; amount_owed: number; units: number | null }[];
}

// One row in the breakdown: this person's share of a single expense
export interface BreakdownCharge {
  expenseId: string;
  description: string;
  amountOwed: number;
  units: number | null; // units consumed on a QUANTITY split; null on EVEN/CUSTOM
  payerName: string; // who fronted this expense, so the reader knows who they're reimbursing
}

// One expense this person paid for out of pocket, which offsets what they're charged
export interface BreakdownPayment {
  expenseId: string;
  description: string;
  amount: number;
}

export interface ParticipantBreakdown {
  charges: BreakdownCharge[];
  payments: BreakdownPayment[];
  totalCharged: number; // sum of their shares across every expense
  totalPaid: number; // sum of expenses they fronted
  netOwed: number; // totalCharged - totalPaid; positive means they still owe this much overall
}

// Round to centavos — the running sums are additions of already-rounded amounts, so without this
// the totals can pick up float noise (e.g. 175.00000000000003) and render a misleading figure
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// Everything one participant is charged for, everything they fronted, and the net of the two.
// Note this describes a PERSON, not a single settlement payment: the settlement plan is a
// simplified routing of net balances, so a given payment row often can't be traced back to
// specific line items (the debtor and creditor may never have shared an expense at all).
export function buildParticipantBreakdown(
  participantId: string,
  expenses: BreakdownExpense[],
): ParticipantBreakdown {
  const charges: BreakdownCharge[] = [];
  const payments: BreakdownPayment[] = [];

  for (const expense of expenses) {
    // Their share of this expense, if they're part of the split at all
    const split = expense.splits.find((s) => s.participant_id === participantId);
    if (split) {
      charges.push({
        expenseId: expense.id,
        description: expense.description,
        amountOwed: split.amount_owed,
        units: split.units,
        payerName: expense.payer.name,
      });
    }

    // Expenses they fronted, which count against what they owe
    if (expense.payer.id === participantId) {
      payments.push({ expenseId: expense.id, description: expense.description, amount: expense.amount });
    }
  }

  const totalCharged = toCents(charges.reduce((sum, c) => sum + c.amountOwed, 0));
  const totalPaid = toCents(payments.reduce((sum, p) => sum + p.amount, 0));

  return { charges, payments, totalCharged, totalPaid, netOwed: toCents(totalCharged - totalPaid) };
}
