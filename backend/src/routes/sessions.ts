import { Router } from "express";
import { prisma } from "../db";
import { computeSettlements } from "../lib/settle";

// Sub-router for everything mounted under /api/sessions in index.ts
export const sessionsRouter = Router();

// POST /api/sessions — create a session and its initial participants together
sessionsRouter.post("/", async (req, res) => {
  const { name, participants } = req.body;

  // Validate at the boundary: reject bad input before it reaches Prisma
  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required" });
  }
  if (!Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({ error: "participants must be a non-empty array of names" });
  }

  // Nested write: creates the Session row and all Participant rows in one transaction
  const session = await prisma.session.create({
    data: {
      name,
      participants: {
        create: participants.map((participantName: string) => ({ name: participantName })),
      },
    },
    include: { participants: true },
  });

  res.status(201).json(session);
});

// GET /api/sessions/:sessionId — fetch a session with everything needed to render it
sessionsRouter.get("/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: true,
      expenses: {
        include: {
          payer: true,
          splits: { include: { participant: true } },
        },
      },
    },
  });

  // findUnique returns null rather than throwing when nothing matches
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  res.json(session);
});

// POST /api/sessions/:sessionId/participants — add one participant to an existing session
sessionsRouter.post("/:sessionId/participants", async (req, res) => {
  const { sessionId } = req.params;
  const { name } = req.body;

  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required" });
  }

  // Confirm the parent session exists before attaching a participant to it
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  const participant = await prisma.participant.create({
    data: { name, session_id: sessionId },
  });

  res.status(201).json(participant);
});

// PATCH /api/sessions/:sessionId/participants/:participantId — a participant sets their own payment method
sessionsRouter.patch("/:sessionId/participants/:participantId", async (req, res) => {
  const { sessionId, participantId } = req.params;
  const { payment_method_type, payment_details } = req.body;

  const validTypes = ["GCASH", "MAYA", "BANK_TRANSFER"];
  if (!validTypes.includes(payment_method_type)) {
    return res.status(400).json({ error: `payment_method_type must be one of ${validTypes.join(", ")}` });
  }
  if (typeof payment_details !== "string" || payment_details.trim() === "") {
    return res.status(400).json({ error: "payment_details is required" });
  }

  // Scope the lookup to this session, same pattern as the expense delete route
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, session_id: sessionId },
  });
  if (!participant) {
    return res.status(404).json({ error: "participant not found in this session" });
  }

  const updated = await prisma.participant.update({
    where: { id: participantId },
    data: { payment_method_type, payment_details },
  });

  res.json(updated);
});

// POST /api/sessions/:sessionId/expenses — add an expense, split EVEN across chosen
// participants or CUSTOM with manual per-participant amounts
sessionsRouter.post("/:sessionId/expenses", async (req, res) => {
  const { sessionId } = req.params;
  const { description, amount, paid_by, split_type, participant_ids, splits, quantity } = req.body;

  if (typeof description !== "string" || description.trim() === "") {
    return res.status(400).json({ error: "description is required" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }
  if (typeof paid_by !== "string") {
    return res.status(400).json({ error: "paid_by is required" });
  }
  if (split_type !== "EVEN" && split_type !== "CUSTOM" && split_type !== "QUANTITY") {
    return res.status(400).json({ error: "split_type must be EVEN, CUSTOM, or QUANTITY" });
  }

  // Confirm the session exists, and pull its participants to validate every id against
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { participants: true },
  });
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  const participantIdsInSession = new Set(session.participants.map((p) => p.id));
  if (!participantIdsInSession.has(paid_by)) {
    return res.status(400).json({ error: "paid_by must be a participant in this session" });
  }

  // Build the ExpenseSplit rows up front so every branch feeds the same create() call below
  let splitRows: { participant_id: string; amount_owed: number; units?: number }[];
  // Total units, stored on the expense only for a QUANTITY split (null otherwise)
  let expenseQuantity: number | null = null;

  if (split_type === "EVEN") {
    if (!Array.isArray(participant_ids) || participant_ids.length === 0) {
      return res.status(400).json({ error: "participant_ids must be a non-empty array for an EVEN split" });
    }
    if (!participant_ids.every((id: string) => participantIdsInSession.has(id))) {
      return res.status(400).json({ error: "participant_ids must all belong to this session" });
    }

    // Even share, rounded to the cent — matches how the group already splits bills by hand
    const share = Math.round((amount / participant_ids.length) * 100) / 100;
    splitRows = participant_ids.map((id: string) => ({ participant_id: id, amount_owed: share }));
  } else if (split_type === "CUSTOM") {
    if (!Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ error: "splits must be a non-empty array for a CUSTOM split" });
    }
    const validShape = splits.every(
      (s: any) =>
        typeof s.participant_id === "string" &&
        participantIdsInSession.has(s.participant_id) &&
        typeof s.amount_owed === "number" &&
        s.amount_owed > 0
    );
    if (!validShape) {
      return res.status(400).json({ error: "each split needs a valid participant_id and a positive amount_owed" });
    }

    // The splits must actually add up to what was paid, or settlements downstream would be wrong
    const total = splits.reduce((sum: number, s: { amount_owed: number }) => sum + s.amount_owed, 0);
    if (Math.abs(total - amount) > 0.01) {
      return res.status(400).json({ error: "splits must sum to the expense amount" });
    }

    splitRows = splits.map((s: { participant_id: string; amount_owed: number }) => ({
      participant_id: s.participant_id,
      amount_owed: s.amount_owed,
    }));
  } else {
    // QUANTITY: each person consumed some whole number of identical units priced at amount / quantity
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "quantity must be a positive whole number for a QUANTITY split" });
    }
    if (!Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ error: "splits must be a non-empty array for a QUANTITY split" });
    }
    const validShape = splits.every(
      (s: any) =>
        typeof s.participant_id === "string" &&
        participantIdsInSession.has(s.participant_id) &&
        Number.isInteger(s.units) &&
        s.units > 0
    );
    if (!validShape) {
      return res.status(400).json({ error: "each split needs a valid participant_id and a positive whole number of units" });
    }

    // The per-person units must add up to the total quantity ordered
    const totalUnits = splits.reduce((sum: number, s: { units: number }) => sum + s.units, 0);
    if (totalUnits !== quantity) {
      return res.status(400).json({ error: `units add up to ${totalUnits}, but quantity is ${quantity}` });
    }

    // Compute each person's share from the unit price, rounded to the cent
    const unitPrice = amount / quantity;
    splitRows = splits.map((s: { participant_id: string; units: number }) => ({
      participant_id: s.participant_id,
      units: s.units,
      amount_owed: Math.round(s.units * unitPrice * 100) / 100,
    }));

    // Per-cent rounding can leave the splits a few centavos off the total — push the remainder onto the first person
    const allocated = splitRows.reduce((sum, r) => sum + r.amount_owed, 0);
    const remainder = Math.round((amount - allocated) * 100) / 100;
    if (remainder !== 0) {
      splitRows[0].amount_owed = Math.round((splitRows[0].amount_owed + remainder) * 100) / 100;
    }

    expenseQuantity = quantity;
  }

  // Nested write: creates the Expense and all its ExpenseSplit rows in one transaction
  const expense = await prisma.expense.create({
    data: {
      session_id: sessionId,
      paid_by,
      amount,
      description,
      split_type,
      quantity: expenseQuantity,
      splits: { create: splitRows },
    },
    include: { payer: true, splits: { include: { participant: true } } },
  });

  res.status(201).json(expense);
});

// DELETE /api/sessions/:sessionId/expenses/:expenseId — remove a mistaken or duplicate expense
sessionsRouter.delete("/:sessionId/expenses/:expenseId", async (req, res) => {
  const { sessionId, expenseId } = req.params;

  // Scope the lookup to this session too, so you can't delete another session's expense by id
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, session_id: sessionId },
  });
  if (!expense) {
    return res.status(404).json({ error: "expense not found in this session" });
  }

  // onDelete: Cascade on ExpenseSplit means its rows are removed in the same operation
  await prisma.expense.delete({ where: { id: expenseId } });

  res.status(204).send();
});

// GET /api/sessions/:sessionId/settlements — who owes who, computed fresh from current expenses
sessionsRouter.get("/:sessionId/settlements", async (req, res) => {
  const { sessionId } = req.params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: true,
      expenses: { include: { splits: true } },
    },
  });
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  // Net balance per participant: what they paid for, minus what they owe across all splits
  const balances = session.participants.map((participant) => {
    const paid = session.expenses
      .filter((e) => e.paid_by === participant.id)
      .reduce((sum, e) => sum + e.amount, 0);

    const owed = session.expenses
      .flatMap((e) => e.splits)
      .filter((s) => s.participant_id === participant.id)
      .reduce((sum, s) => sum + s.amount_owed, 0);

    return { participantId: participant.id, balance: paid - owed };
  });

  const participantsById = new Map(session.participants.map((p) => [p.id, p]));

  // Attach names so the response is directly readable, not just a list of ids
  const settlements = computeSettlements(balances).map((s) => ({
    from_id: s.from_id,
    from_name: participantsById.get(s.from_id)?.name,
    to_id: s.to_id,
    to_name: participantsById.get(s.to_id)?.name,
    amount: s.amount,
  }));

  res.json({ settlements });
});
