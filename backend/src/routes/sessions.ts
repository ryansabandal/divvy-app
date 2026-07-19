import { Router } from "express";
import { prisma } from "../db";
import { computeSettlements, RECONCILED_EPSILON } from "../lib/settle";
import { createSessionSchema, createExpenseSchema } from "../schemas/sessions";

// Sub-router for everything mounted under /api/sessions in index.ts
export const sessionsRouter = Router();

// Matches an RFC 4122 UUID — session ids are always one of these, so anything else can never
// match a row and would otherwise reach Postgres as a raw "invalid input syntax" error (500)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Runs before any route below with a :sessionId segment — turns a malformed id into a clean
// 404 up front instead of letting every handler hit the same Postgres error independently
sessionsRouter.param("sessionId", (_req, res, next, sessionId) => {
  if (!UUID_RE.test(sessionId)) {
    return res.status(404).json({ error: "session not found" });
  }
  next();
});

// Net balance per participant: what they paid for, minus what they owe across all splits.
// Positive = they're owed money, negative = they owe. Shared by the preview + freeze routes
// so the math has exactly one home. Structural typing lets it accept the Prisma query result.
function computeNetBalances(
  participants: { id: string }[],
  expenses: { paid_by: string; amount: number; splits: { participant_id: string; amount_owed: number }[] }[],
) {
  return participants.map((participant) => {
    // Sum of every expense this participant fronted
    const paid = expenses
      .filter((e) => e.paid_by === participant.id)
      .reduce((sum, e) => sum + e.amount, 0);

    // Sum of this participant's share across every expense's splits
    const owed = expenses
      .flatMap((e) => e.splits)
      .filter((s) => s.participant_id === participant.id)
      .reduce((sum, s) => sum + s.amount_owed, 0);

    return { participantId: participant.id, balance: paid - owed };
  });
}

// Returns true if two settlement plans are equivalent — same payers, payees, and amounts.
// Used to detect whether the frozen plan is stale after expenses are added or deleted.
function settlementPlansMatch(
  frozen: { from_id: string; to_id: string; amount: number }[],
  live: { from_id: string; to_id: string; amount: number }[],
): boolean {
  if (frozen.length !== live.length) return false;
  const key = (s: { from_id: string; to_id: string }) => `${s.from_id}:${s.to_id}`;
  const sortedFrozen = [...frozen].sort((a, b) => key(a).localeCompare(key(b)));
  const sortedLive   = [...live].sort((a, b) => key(a).localeCompare(key(b)));
  return sortedFrozen.every(
    (f, i) =>
      f.from_id === sortedLive[i].from_id &&
      f.to_id   === sortedLive[i].to_id &&
      Math.abs(f.amount - sortedLive[i].amount) < 0.01,
  );
}

// Shape a stored Settlement row (with debtor/creditor included) into the API response —
// flat ids + names + paid flag, so GET-frozen, POST-freeze, and PATCH all return the same thing
function serializeSettlement(s: {
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

// Shape a Participant row for the API response — drops sort_order (an internal list-ordering
// mechanism) and created_at (never read by the frontend)
function serializeParticipant(p: {
  id: string;
  name: string;
  payment_method_type: string | null;
  payment_details: string | null;
}) {
  return {
    id: p.id,
    name: p.name,
    payment_method_type: p.payment_method_type,
    payment_details: p.payment_details,
  };
}

// Shape one ExpenseSplit row — drops expense_id (redundant, it's already nested under its expense)
function serializeExpenseSplit(s: {
  id: string;
  participant_id: string;
  amount_owed: number;
  units: number | null;
  participant: { id: string; name: string; payment_method_type: string | null; payment_details: string | null };
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
function serializeExpense(e: {
  id: string;
  amount: number;
  description: string;
  split_type: string;
  quantity: number | null;
  payer: { id: string; name: string; payment_method_type: string | null; payment_details: string | null };
  splits: {
    id: string;
    participant_id: string;
    amount_owed: number;
    units: number | null;
    participant: { id: string; name: string; payment_method_type: string | null; payment_details: string | null };
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

// POST /api/sessions — create a session and its initial participants together
sessionsRouter.post("/", async (req, res) => {
  // Validate at the boundary: rejects bad shape (e.g. empty names, missing fields) before it reaches Prisma
  const result = createSessionSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }
  const { name, participants } = result.data;

  // Nested write: creates the Session row and all Participant rows in one transaction
  const session = await prisma.session.create({
    data: {
      name,
      participants: {
        create: participants.map((participantName) => ({ name: participantName })),
      },
    },
    include: { participants: { orderBy: { sort_order: "asc" } } },
  });

  res.status(201).json({
    id: session.id,
    name: session.name,
    participants: session.participants.map(serializeParticipant),
  });
});

// GET /api/sessions/:sessionId — fetch a session with everything needed to render it
sessionsRouter.get("/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: { orderBy: { sort_order: "asc" } },
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

  res.json({
    id: session.id,
    name: session.name,
    participants: session.participants.map(serializeParticipant),
    expenses: session.expenses.map(serializeExpense),
  });
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
    data: { name: name.trim(), session_id: sessionId },
  });

  res.status(201).json(serializeParticipant(participant));
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

  res.json(serializeParticipant(updated));
});

// POST /api/sessions/:sessionId/expenses — add an expense, split EVEN across chosen
// participants, CUSTOM with manual per-participant amounts, or QUANTITY by units consumed
sessionsRouter.post("/:sessionId/expenses", async (req, res) => {
  const { sessionId } = req.params;

  // Shape-level validation — structure and types only; DB-level checks (session, participant membership) follow after
  const parseResult = createExpenseSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0].message });
  }
  const body = parseResult.data;
  const { description, amount, paid_by } = body;

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

  if (body.split_type === "EVEN") {
    const { participant_ids } = body;
    if (!participant_ids.every((id) => participantIdsInSession.has(id))) {
      return res.status(400).json({ error: "participant_ids must all belong to this session" });
    }
    // A repeated ID would double-charge that person and inflate the even-share denominator
    if (new Set(participant_ids).size !== participant_ids.length) {
      return res.status(400).json({ error: "participant_ids must not contain duplicates" });
    }

    // Even share, rounded to the cent — matches how the group already splits bills by hand
    const share = Math.round((amount / participant_ids.length) * 100) / 100;
    splitRows = participant_ids.map((id) => ({ participant_id: id, amount_owed: share }));

    // Per-cent rounding can leave the splits a few centavos off the total — push the remainder onto the first person
    const allocated = splitRows.reduce((sum, r) => sum + r.amount_owed, 0);
    const remainder = Math.round((amount - allocated) * 100) / 100;
    if (remainder !== 0) {
      splitRows[0].amount_owed = Math.round((splitRows[0].amount_owed + remainder) * 100) / 100;
    }
  } else if (body.split_type === "CUSTOM") {
    const { splits } = body;
    if (!splits.every((s) => participantIdsInSession.has(s.participant_id))) {
      return res.status(400).json({ error: "each split needs a valid participant_id and a positive amount_owed" });
    }
    // A repeated participant_id would create two split rows for the same person
    const customIds = splits.map((s) => s.participant_id);
    if (new Set(customIds).size !== customIds.length) {
      return res.status(400).json({ error: "splits must not contain duplicate participant_ids" });
    }

    // The splits must actually add up to what was paid, or settlements downstream would be wrong.
    // Tightened to half a centavo (not a full cent) — these are hand-entered amounts, so a
    // real mismatch should be rejected and fixed by the user rather than silently absorbed.
    const total = splits.reduce((sum, s) => sum + s.amount_owed, 0);
    if (Math.abs(total - amount) > RECONCILED_EPSILON) {
      return res.status(400).json({ error: "splits must sum to the expense amount" });
    }

    splitRows = splits.map((s) => ({
      participant_id: s.participant_id,
      amount_owed: s.amount_owed,
    }));
  } else {
    // QUANTITY: each person consumed some whole number of identical units priced at amount / quantity
    const { quantity, splits } = body;
    if (!splits.every((s) => participantIdsInSession.has(s.participant_id))) {
      return res.status(400).json({ error: "each split needs a valid participant_id and a positive whole number of units" });
    }
    // A repeated participant_id would create two split rows for the same person
    const quantityIds = splits.map((s) => s.participant_id);
    if (new Set(quantityIds).size !== quantityIds.length) {
      return res.status(400).json({ error: "splits must not contain duplicate participant_ids" });
    }

    // The per-person units must add up to the total quantity ordered
    const totalUnits = splits.reduce((sum, s) => sum + s.units, 0);
    if (totalUnits !== quantity) {
      return res.status(400).json({ error: `units add up to ${totalUnits}, but quantity is ${quantity}` });
    }

    // Compute each person's share from the unit price, rounded to the cent
    const unitPrice = amount / quantity;
    splitRows = splits.map((s) => ({
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
      split_type: body.split_type,
      quantity: expenseQuantity,
      splits: { create: splitRows },
    },
    include: { payer: true, splits: { include: { participant: true } } },
  });

  res.status(201).json(serializeExpense(expense));
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

// GET /api/sessions/:sessionId/settlements — the settlement plan for this session.
// If a plan has been frozen (locked in), return those stored rows with their paid state;
// otherwise return a fresh, unsaved preview computed from the current expenses.
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

  // A frozen plan, once it exists, is the source of truth — return it with paid flags + names
  const frozen = await prisma.settlement.findMany({
    where: { session_id: sessionId },
    include: { debtor: true, creditor: true },
  });
  if (frozen.length > 0) {
    // Also compute what the live plan looks like today so we can flag staleness if expenses changed
    const balances = computeNetBalances(session.participants, session.expenses);
    const livePlan = computeSettlements(balances);
    const stale = !settlementPlansMatch(frozen, livePlan);
    return res.json({ frozen: true, stale, settlements: frozen.map(serializeSettlement) });
  }

  // No frozen plan yet — compute a preview from current balances (not saved to the DB)
  const balances = computeNetBalances(session.participants, session.expenses);
  const participantsById = new Map(session.participants.map((p) => [p.id, p]));
  const settlements = computeSettlements(balances).map((s) => ({
    from_id: s.from_id,
    from_name: participantsById.get(s.from_id)?.name,
    to_id: s.to_id,
    to_name: participantsById.get(s.to_id)?.name,
    amount: s.amount,
  }));

  res.json({ frozen: false, stale: false, settlements });
});

// POST /api/sessions/:sessionId/settlements — freeze (lock in) the current plan so payments can
// be marked off as paid. Recomputes from current expenses and replaces any previously frozen
// plan, which is also how "recalculate" works: re-freezing wipes the old plan and its paid state.
sessionsRouter.post("/:sessionId/settlements", async (req, res) => {
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

  // Compute the minimized plan we're about to persist
  const balances = computeNetBalances(session.participants, session.expenses);
  const plan = computeSettlements(balances);

  // Replace any existing frozen plan atomically: clear the old rows, then insert the new ones
  await prisma.$transaction([
    prisma.settlement.deleteMany({ where: { session_id: sessionId } }),
    prisma.settlement.createMany({
      data: plan.map((s) => ({
        session_id: sessionId,
        from_id: s.from_id,
        to_id: s.to_id,
        amount: s.amount,
      })),
    }),
  ]);

  // createMany doesn't return rows, so re-read with names to match the frozen GET response shape
  const frozen = await prisma.settlement.findMany({
    where: { session_id: sessionId },
    include: { debtor: true, creditor: true },
  });
  res.status(201).json({ frozen: true, settlements: frozen.map(serializeSettlement) });
});

// PATCH /api/sessions/:sessionId/settlements/:settlementId — mark one frozen payment paid/unpaid
sessionsRouter.patch("/:sessionId/settlements/:settlementId", async (req, res) => {
  const { sessionId, settlementId } = req.params;
  const { paid } = req.body;

  if (typeof paid !== "boolean") {
    return res.status(400).json({ error: "paid must be true or false" });
  }

  // Scope to this session so you can't flip another session's settlement by id
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, session_id: sessionId },
  });
  if (!settlement) {
    return res.status(404).json({ error: "settlement not found in this session" });
  }

  const updated = await prisma.settlement.update({
    where: { id: settlementId },
    data: { paid },
    include: { debtor: true, creditor: true },
  });

  res.json(serializeSettlement(updated));
});
