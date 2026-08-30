import type { z } from "zod";
import { RECONCILED_EPSILON } from "./settle";
import { distributeCents } from "./money";
import type { createExpenseSchema } from "../schemas/sessions";

// Result of buildExpenseSplits: either the rows are ready to persist, or a DB-level validation
// failed (Zod already checked shape/types; this checks things only the session's participant
// list can answer, e.g. whether an id actually belongs to this session)
export type SplitBuildResult =
  | {
      ok: true;
      splitRows: { participant_id: string; amount_owed: number; units?: number }[];
      expenseQuantity: number | null;
    }
  | { ok: false; error: string };

// Builds the ExpenseSplit rows (and, for QUANTITY, the Expense.quantity value) for one of the
// three split types. Shared by POST (create) and PATCH (edit) so the duplicate-id and
// sum guards have exactly one home instead of two copies; the centavo apportionment
// behind EVEN and QUANTITY lives in lib/money.ts.
export function buildExpenseSplits(
  body: z.infer<typeof createExpenseSchema>,
  participantIdsInSession: Set<string>,
): SplitBuildResult {
  const { amount } = body;

  if (body.split_type === "EVEN") {
    const { participant_ids } = body;
    if (!participant_ids.every((id) => participantIdsInSession.has(id))) {
      return { ok: false, error: "participant_ids must all belong to this session" };
    }
    // A repeated ID would double-charge that person and inflate the even-share denominator
    if (new Set(participant_ids).size !== participant_ids.length) {
      return { ok: false, error: "participant_ids must not contain duplicates" };
    }

    // Equal weights, so everyone owes the same whole centavo except the few who absorb the
    // leftover — matches how the group already splits bills by hand
    const cents = distributeCents(Math.round(amount * 100), participant_ids.map(() => 1));
    const splitRows = participant_ids.map((id, i) => ({
      participant_id: id,
      amount_owed: (cents[i] ?? 0) / 100,
    }));

    return { ok: true, splitRows, expenseQuantity: null };
  }

  if (body.split_type === "CUSTOM") {
    const { splits } = body;
    if (!splits.every((s) => participantIdsInSession.has(s.participant_id))) {
      return { ok: false, error: "each split needs a valid participant_id and a positive amount_owed" };
    }
    // A repeated participant_id would create two split rows for the same person
    const customIds = splits.map((s) => s.participant_id);
    if (new Set(customIds).size !== customIds.length) {
      return { ok: false, error: "splits must not contain duplicate participant_ids" };
    }

    // The splits must actually add up to what was paid, or settlements downstream would be wrong.
    // Tightened to half a centavo (not a full cent) — these are hand-entered amounts, so a
    // real mismatch should be rejected and fixed by the user rather than silently absorbed.
    const total = splits.reduce((sum, s) => sum + s.amount_owed, 0);
    if (Math.abs(total - amount) > RECONCILED_EPSILON) {
      return { ok: false, error: "splits must sum to the expense amount" };
    }

    const splitRows = splits.map((s) => ({ participant_id: s.participant_id, amount_owed: s.amount_owed }));
    return { ok: true, splitRows, expenseQuantity: null };
  }

  // QUANTITY: each person consumed some whole number of identical units priced at amount / quantity
  const { quantity, splits } = body;
  if (!splits.every((s) => participantIdsInSession.has(s.participant_id))) {
    return { ok: false, error: "each split needs a valid participant_id and a positive whole number of units" };
  }
  // A repeated participant_id would create two split rows for the same person
  const quantityIds = splits.map((s) => s.participant_id);
  if (new Set(quantityIds).size !== quantityIds.length) {
    return { ok: false, error: "splits must not contain duplicate participant_ids" };
  }

  // The per-person units must add up to the total quantity ordered
  const totalUnits = splits.reduce((sum, s) => sum + s.units, 0);
  if (totalUnits !== quantity) {
    return { ok: false, error: `units add up to ${totalUnits}, but quantity is ${quantity}` };
  }

  // Each person's share weighted by the units they consumed, so the leftover centavos land on
  // the shares that lost the most to rounding rather than all on one person
  const cents = distributeCents(Math.round(amount * 100), splits.map((s) => s.units));
  const splitRows = splits.map((s, i) => ({
    participant_id: s.participant_id,
    units: s.units,
    amount_owed: (cents[i] ?? 0) / 100,
  }));

  return { ok: true, splitRows, expenseQuantity: quantity };
}
