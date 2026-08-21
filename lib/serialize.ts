// Response-shaping functions shared across the sessions API route handlers — each one strips
// internal database columns (sort_order, session_id, etc.) that the frontend never needs.
//
// Each function's return type is an explicit shared interface from lib/types.ts, the same one the
// pages import — so if a future edit here stopped matching what a page expects, tsc would catch it
// at build time instead of the drift surfacing later as a page-only type (see lib/types.ts header).
import type { Participant, ExpenseSplit, Expense, Settlement, PaymentMethodType, SplitType } from "./types";
import { publicObjectUrl } from "./storageUrl";

// Shared shape for a Participant as it appears nested inside other rows (payer, split.participant)
type ParticipantLike = {
  id: string;
  name: string;
  payment_method_type: PaymentMethodType | null;
  payment_details: string | null;
  qr_object_path: string | null;
};

// Shape a Participant row for the API response — drops sort_order (an internal list-ordering
// mechanism), created_at (never read by the frontend), and the raw qr_object_path (the response
// exposes a ready-to-use URL instead, derived here rather than stored, so a bucket rename is a
// config change rather than a data migration)
export function serializeParticipant(p: ParticipantLike): Participant {
  return {
    id: p.id,
    name: p.name,
    payment_method_type: p.payment_method_type,
    payment_details: p.payment_details,
    qr_code_url: p.qr_object_path ? publicObjectUrl(p.qr_object_path) : null,
  };
}

// Shape one ExpenseSplit row — drops expense_id (redundant, it's already nested under its expense)
export function serializeExpenseSplit(s: {
  id: string;
  participant_id: string;
  amount_owed: number;
  units: number | null;
  participant: ParticipantLike;
}): ExpenseSplit {
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
  split_type: SplitType;
  quantity: number | null;
  payer: ParticipantLike;
  splits: {
    id: string;
    participant_id: string;
    amount_owed: number;
    units: number | null;
    participant: ParticipantLike;
  }[];
}): Expense {
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
}): Required<Settlement> {
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
