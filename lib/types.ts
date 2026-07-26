// Shared shapes for the JSON the API returns, consumed by every session page. One home for these
// instead of three redeclared copies — see lib/serialize.ts, whose serialize* functions are
// annotated to return exactly these types, so a mismatch between the two is a compile error.

export type PaymentMethodType = "GCASH" | "MAYA" | "BANK_TRANSFER";
export type SplitType = "EVEN" | "CUSTOM" | "QUANTITY";

export interface Participant {
  id: string;
  name: string;
  payment_method_type: PaymentMethodType | null;
  payment_details: string | null;
}

export interface ExpenseSplit {
  id: string;
  participant_id: string;
  amount_owed: number;
  units: number | null;
  participant: Participant;
}

export interface Expense {
  id: string;
  amount: number;
  description: string;
  split_type: SplitType;
  quantity: number | null;
  payer: Participant;
  splits: ExpenseSplit[];
}

// This is GET /api/sessions/:sessionId's response shape. POST /api/sessions returns a narrower
// subset (id, name, participants — no expenses yet, since none exist on creation); don't reuse
// this type for that response without accounting for the missing field.
export interface Session {
  id: string;
  name: string;
  participants: Participant[];
  expenses: Expense[];
}

// id/paid are only present once the plan is frozen — a live preview (computed fresh, not yet
// persisted) omits both.
export interface Settlement {
  id?: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  amount: number;
  paid?: boolean;
}

// This is GET .../settlements's response shape (frozen flag + a stale flag for when expenses
// changed after the plan was finalized). POST .../settlements — finalize/recalculate — returns
// only { frozen: true, settlements }, with no stale field; don't reuse this type for that
// response without accounting for the missing field.
export interface SettlementsResponse {
  frozen: boolean;
  stale: boolean;
  settlements: Settlement[];
}
