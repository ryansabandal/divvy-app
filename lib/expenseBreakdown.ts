// Shared by the settle and read-only view pages so "what is this person actually being charged
// for" is computed in exactly one place. Pure — no fetching, no React — so it stays easy to reason about.

import { roundToCents } from "./money";

// Minimal shape this module needs from an expense. Declared structurally (rather than importing a
// page's interface) so each page's richer local type satisfies it without any casting — the same
// approach computeNetBalances uses on the backend.
export interface BreakdownExpense {
  id: string;
  description: string;
  amount: number;
  payer: { id: string; name: string };
  quantity: number | null;
  splits: { participant_id: string; amount_owed: number; units: number | null }[];
}

// One row in the breakdown: this person's share of a single expense
export interface BreakdownCharge {
  expenseId: string;
  description: string;
  amountOwed: number;
  units: number | null; // units consumed, only when the expense has more than one unit to
  // distinguish; null on EVEN/CUSTOM and on a quantity-1 QUANTITY split, where "×1" would
  // just restate the amount
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
        units: expense.quantity !== null && expense.quantity > 1 ? split.units : null,
        payerName: expense.payer.name,
      });
    }

    // Expenses they fronted, which count against what they owe
    if (expense.payer.id === participantId) {
      payments.push({ expenseId: expense.id, description: expense.description, amount: expense.amount });
    }
  }

  const totalCharged = roundToCents(charges.reduce((sum, c) => sum + c.amountOwed, 0));
  const totalPaid = roundToCents(payments.reduce((sum, p) => sum + p.amount, 0));

  return { charges, payments, totalCharged, totalPaid, netOwed: roundToCents(totalCharged - totalPaid) };
}
