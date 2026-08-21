import { z } from "zod";
import { PaymentMethodType } from "@prisma/client";

// Reusable base fields shared by all three expense split types
const expenseBase = {
  description: z.string().trim().min(1, "description is required").max(200, "description is too long"),
  amount: z.number().positive("amount must be a positive number").finite(),
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
// checks the path is actually scoped to this session — see qrObjectPrefix().
export const setQrObjectPathSchema = z.object({
  path: z.string().min(1, "path is required"),
});

// Schema for PATCH /api/sessions/:sessionId/expenses (bulk reorder)
export const reorderExpensesSchema = z.object({
  expense_ids: z.array(z.string()).max(50, "expense_ids must be 50 or fewer"),
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
          amount_owed: z.number().positive("amount_owed must be a positive number"),
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
      .positive("quantity must be a positive whole number"),
    splits: z
      .array(
        z.object({
          participant_id: z.string(),
          units: z
            .number()
            .int("units must be a whole number")
            .positive("units must be a positive whole number"),
        }),
      )
      .min(1, "splits must be a non-empty array for a QUANTITY split")
      .max(50, "splits must be 50 or fewer"),
  }),
]);
