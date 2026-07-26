// Response-shaping functions shared across the sessions API route handlers — each one strips
// internal database columns (sort_order, session_id, etc.) that the frontend never needs.

// Shared shape for a Participant as it appears nested inside other rows (payer, split.participant)
type ParticipantLike = {
  id: string;
  name: string;
  payment_method_type: string | null;
  payment_details: string | null;
};

// Shape a Participant row for the API response — drops sort_order (an internal list-ordering
// mechanism) and created_at (never read by the frontend)
export function serializeParticipant(p: ParticipantLike) {
  return {
    id: p.id,
    name: p.name,
    payment_method_type: p.payment_method_type,
    payment_details: p.payment_details,
  };
}

// Shape one ExpenseSplit row — drops expense_id (redundant, it's already nested under its expense)
export function serializeExpenseSplit(s: {
  id: string;
  participant_id: string;
  amount_owed: number;
  units: number | null;
  participant: ParticipantLike;
}) {
  return {
    id: s.id,
    participant_id: s.participant_id,
    amount_owed: s.amount_owed,
    units: s.units,
    participant: serializeParticipant(s.participant),
  };
}

// Shape an Expense row — drops session_id (redundant, nested under its session) and the raw
// paid_by id (the serialized payer object below supersedes it)
export function serializeExpense(e: {
  id: string;
  amount: number;
  description: string;
  split_type: string;
  quantity: number | null;
  payer: ParticipantLike;
  splits: {
    id: string;
    participant_id: string;
    amount_owed: number;
    units: number | null;
    participant: ParticipantLike;
  }[];
}) {
  return {
    id: e.id,
    amount: e.amount,
    description: e.description,
    split_type: e.split_type,
    quantity: e.quantity,
    payer: serializeParticipant(e.payer),
    splits: e.splits.map(serializeExpenseSplit),
  };
}

// Shape a stored Settlement row (with debtor/creditor included) into the API response —
// flat ids + names + paid flag, so GET-frozen, POST-freeze, and PATCH all return the same thing
export function serializeSettlement(s: {
  id: string;
  from_id: string;
  to_id: string;
  amount: number;
  paid: boolean;
  debtor: { name: string };
  creditor: { name: string };
}) {
  return {
    id: s.id,
    from_id: s.from_id,
    from_name: s.debtor.name,
    to_id: s.to_id,
    to_name: s.creditor.name,
    amount: s.amount,
    paid: s.paid,
  };
}
