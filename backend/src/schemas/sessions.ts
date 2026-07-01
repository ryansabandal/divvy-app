import { z } from "zod";

// Reusable base fields shared by all three expense split types
const expenseBase = {
  description: z.string().trim().min(1, "description is required"),
  amount: z.number().positive("amount must be a positive number").finite(),
  paid_by: z.string().min(1, "paid_by is required"),
};

// Schema for POST /api/sessions: validates name is non-empty and every participant name is too
export const createSessionSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  participants: z
    .array(z.string().trim().min(1, "each participant name must be a non-empty string"))
    .min(1, "participants must be a non-empty array of names"),
});

// Schema for POST /api/sessions/:sessionId/expenses: discriminated union so each split_type gets its own shape
export const createExpenseSchema = z.discriminatedUnion("split_type", [
  // EVEN: a list of participant IDs to split the bill across equally
  z.object({
    ...expenseBase,
    split_type: z.literal("EVEN"),
    participant_ids: z
      .array(z.string())
      .min(1, "participant_ids must be a non-empty array for an EVEN split"),
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
      .min(1, "splits must be a non-empty array for a CUSTOM split"),
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
      .min(1, "splits must be a non-empty array for a QUANTITY split"),
  }),
]);
