import { z } from "zod";
import { PaymentMethodType } from "@prisma/client";

// Ceiling for any single peso amount in the app (amount, amount_owed). 1e8 keeps 50 summed
// expenses (MAX_EXPENSES_PER_SESSION) inside 2^53 once converted to centavos, so Math.round(x * 100)
// stays exact and lib/settle.ts's computeSettlements can never overflow to Infinity/NaN.
export const MAX_AMOUNT = 100_000_000;

// Ceiling for QUANTITY split units. lib/money.ts's distributeCents() computes totalCents * units,
// which must stay inside 2^53 even at MAX_AMOUNT — 1e14 at this cap, comfortably exact.
export const MAX_UNITS = 10_000;

// Reusable base fields shared by all three expense split types
const expenseBase = {
  description: z.string().trim().min(1, "description is required").max(200, "description is too long"),
  amount: z.number().positive("amount must be a positive number").finite().max(MAX_AMOUNT, "amount is too large"),
  paid_by: z.string().min(1, "paid_by is required"),
};

// Schema for POST /api/sessions: validates name is non-empty and every participant name is too
export const createSessionSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100, "name is too long"),
  participants: z
    .array(z.string().trim().min(1, "each participant name must be a non-empty string").max(100, "participant name is too long"))
    .min(1, "participants must be a non-empty array of names")
    .max(50, "participants must be 50 or fewer"),
});

// Schema for POST /api/sessions/:sessionId/participants
export const addParticipantSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100, "name is too long"),
});

// Schema for PATCH /api/sessions/:sessionId/participants/:participantId — a participant sets
// their own payment method. z.nativeEnum ties validation to the Prisma enum directly, so there's
// one source of truth instead of a hand-rolled list of the valid method strings.
export const setPaymentMethodSchema = z.object({
  payment_method_type: z.nativeEnum(PaymentMethodType),
  payment_details: z.string().trim().min(1, "payment_details is required").max(200, "payment_details is too long"),
});

// Schema for PATCH /api/sessions/:sessionId/settlements/:settlementId
export const updateSettlementSchema = z.object({
  paid: z.boolean(),
});

// Schema for PUT /api/sessions/:sessionId/participants/:participantId/qr — persists the object
// path after the client's direct-to-Storage upload succeeds. The route itself (not this schema)
// checks the path is one this session could have minted — see isMintedQrPath(). A minted path
// runs about 85 characters, so the cap rejects an oversized string before it is stored or logged.
export const setQrObjectPathSchema = z.object({
  path: z.string().min(1, "path is required").max(200, "path is too long"),
});

// Payload bound only, sized well above the creation cap in lib/expenseSession.ts: a session that
// overshoots that cap must still be reorderable, so this rejects absurd request bodies and nothing else.
export const MAX_REORDER_IDS = 500;

// Schema for PATCH /api/sessions/:sessionId/expenses (bulk reorder)
export const reorderExpensesSchema = z.object({
  expense_ids: z
    .array(z.string())
    .max(MAX_REORDER_IDS, `expense_ids must be ${MAX_REORDER_IDS} or fewer`),
});

// Schema for POST /api/sessions/:sessionId/expenses: discriminated union so each split_type gets its own shape
export const createExpenseSchema = z.discriminatedUnion("split_type", [
  // EVEN: a list of participant IDs to split the bill across equally
  z.object({
    ...expenseBase,
    split_type: z.literal("EVEN"),
    participant_ids: z
      .array(z.string())
      .min(1, "participant_ids must be a non-empty array for an EVEN split")
      .max(50, "participant_ids must be 50 or fewer"),
  }),
  // CUSTOM: caller provides the exact amount each participant owes
  z.object({
    ...expenseBase,
    split_type: z.literal("CUSTOM"),
    splits: z
      .array(
        z.object({
          participant_id: z.string(),
          amount_owed: z.number().positive("amount_owed must be a positive number").finite().max(MAX_AMOUNT, "amount_owed is too large"),
        }),
      )
      .min(1, "splits must be a non-empty array for a CUSTOM split")
      .max(50, "splits must be 50 or fewer"),
  }),
  // QUANTITY: each participant consumed a whole number of identical units (e.g. shots, slices)
  z.object({
    ...expenseBase,
    split_type: z.literal("QUANTITY"),
    quantity: z
      .number()
      .int("quantity must be a whole number")
      .positive("quantity must be a positive whole number")
      // Expense.quantity is Postgres int4 (max ~2.1e9); this cap stays far under that so an
      // oversized value 400s here instead of failing at the DB write with an unhandled 500.
      .max(1_000_000, "quantity is too large"),
    splits: z
      .array(
        z.object({
          participant_id: z.string(),
          units: z
            .number()
            .int("units must be a whole number")
            .positive("units must be a positive whole number")
            .max(MAX_UNITS, "units is too large"),
        }),
      )
      .min(1, "splits must be a non-empty array for a QUANTITY split")
      .max(50, "splits must be 50 or fewer"),
  }),
]);
