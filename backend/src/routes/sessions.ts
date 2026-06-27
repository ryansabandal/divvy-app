import { Router } from "express";
import { prisma } from "../db";

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

// POST /api/sessions/:sessionId/expenses — add an expense, split EVEN across chosen
// participants or CUSTOM with manual per-participant amounts
sessionsRouter.post("/:sessionId/expenses", async (req, res) => {
  const { sessionId } = req.params;
  const { description, amount, paid_by, split_type, participant_ids, splits } = req.body;

  if (typeof description !== "string" || description.trim() === "") {
    return res.status(400).json({ error: "description is required" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }
  if (typeof paid_by !== "string") {
    return res.status(400).json({ error: "paid_by is required" });
  }
  if (split_type !== "EVEN" && split_type !== "CUSTOM") {
    return res.status(400).json({ error: "split_type must be EVEN or CUSTOM" });
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

  // Build the ExpenseSplit rows up front so both branches feed the same create() call below
  let splitRows: { participant_id: string; amount_owed: number }[];

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
  } else {
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
  }

  // Nested write: creates the Expense and all its ExpenseSplit rows in one transaction
  const expense = await prisma.expense.create({
    data: {
      session_id: sessionId,
      paid_by,
      amount,
      description,
      split_type,
      splits: { create: splitRows },
    },
    include: { payer: true, splits: { include: { participant: true } } },
  });

  res.status(201).json(expense);
});
