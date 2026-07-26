import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireValidSessionId } from "@/lib/validation";
import { serializeExpense } from "@/lib/serialize";
import { buildExpenseSplits } from "@/lib/expenseSplits";
import { loadSessionParticipants, validatePayer } from "@/lib/expenseSession";
import { createExpenseSchema, reorderExpensesSchema } from "@/schemas/sessions";
import { parseBody } from "@/lib/requestBody";

// POST /api/sessions/:sessionId/expenses — add an expense, split EVEN across chosen
// participants, CUSTOM with manual per-participant amounts, or QUANTITY by units consumed
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  // Shape-level validation — structure and types only; DB-level checks (session, participant membership) follow after
  const parseResult = await parseBody(request, createExpenseSchema);
  if (!parseResult.ok) return parseResult.response;
  const body = parseResult.data;
  const { description, amount, paid_by } = body;

  const loadResult = await loadSessionParticipants(sessionId);
  if (!loadResult.ok) return loadResult.response;
  const { participantIdsInSession } = loadResult;
  const payerError = validatePayer(participantIdsInSession, paid_by);
  if (payerError) return payerError;

  const splitResult = buildExpenseSplits(body, participantIdsInSession);
  if (!splitResult.ok) {
    return NextResponse.json({ error: splitResult.error }, { status: 400 });
  }
  const { splitRows, expenseQuantity } = splitResult;

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

  return NextResponse.json(serializeExpense(expense), { status: 201 });
}

// PATCH /api/sessions/:sessionId/expenses — bulk reorder: caller sends every expense id in this
// session in its new order; sort_order is reassigned to match. Deliberately a collection-level
// route (not nested under /:expenseId) so its path can never collide with the edit route —
// a well-known Express footgun this shape sidesteps, and Next's file-based routing keeps the
// same separation naturally (this file vs. [expenseId]/route.ts).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const parseResult = await parseBody(request, reorderExpensesSchema);
  if (!parseResult.ok) return parseResult.response;
  const { expense_ids } = parseResult.data;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { expenses: true },
  });
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // Must cover every expense in the session exactly once — a partial or stale list would
  // silently strand the missing expenses at whatever sort_order they already had
  const currentIds = new Set(session.expenses.map((e) => e.id));
  const providedIds = new Set(expense_ids);
  const isCompleteReorder =
    expense_ids.length === session.expenses.length &&
    providedIds.size === expense_ids.length &&
    expense_ids.every((id: string) => currentIds.has(id));
  if (!isCompleteReorder) {
    return NextResponse.json(
      { error: "expense_ids must include every expense in this session exactly once" },
      { status: 400 },
    );
  }

  await prisma.$transaction(
    expense_ids.map((id, index) =>
      prisma.expense.update({ where: { id }, data: { sort_order: index } }),
    ),
  );

  // The caller already has the new order (it sent it) — no need to re-fetch and re-serialize
  // the whole list, same pattern as DELETE .../expenses/:expenseId
  return new NextResponse(null, { status: 204 });
}
