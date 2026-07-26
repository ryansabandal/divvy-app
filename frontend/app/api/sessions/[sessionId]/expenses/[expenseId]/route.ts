import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireValidSessionId } from "@/lib/validation";
import { serializeExpense } from "@/lib/serialize";
import { buildExpenseSplits } from "@/lib/expenseSplits";
import { loadSessionParticipants, validatePayer } from "@/lib/expenseSession";
import { createExpenseSchema } from "@/schemas/sessions";
import { parseBody } from "@/lib/requestBody";

// PATCH /api/sessions/:sessionId/expenses/:expenseId — edit an expense in place (rebuilds its
// splits from the new values), replacing the old delete-then-recreate-to-fix-a-mistake workflow
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; expenseId: string }> },
) {
  const { sessionId, expenseId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const parseResult = await parseBody(request, createExpenseSchema);
  if (!parseResult.ok) return parseResult.response;
  const body = parseResult.data;
  const { description, amount, paid_by } = body;

  const loadResult = await loadSessionParticipants(sessionId);
  if (!loadResult.ok) return loadResult.response;
  const { participantIdsInSession } = loadResult;

  // Scope to this session, same pattern as DELETE below. No UUID gate on :expenseId — the id
  // column is TEXT, so an arbitrary string is a legal (non-matching) value and 404s cleanly.
  // This check must come before the paid_by validation below — matches the original Express
  // check order (session -> expense -> paid_by), so a request with both a nonexistent expense
  // and an invalid paid_by still gets the more specific "expense not found" 404.
  const existing = await prisma.expense.findFirst({ where: { id: expenseId, session_id: sessionId } });
  if (!existing) {
    return NextResponse.json({ error: "expense not found in this session" }, { status: 404 });
  }

  const payerError = validatePayer(participantIdsInSession, paid_by);
  if (payerError) return payerError;

  const splitResult = buildExpenseSplits(body, participantIdsInSession);
  if (!splitResult.ok) {
    return NextResponse.json({ error: splitResult.error }, { status: 400 });
  }
  const { splitRows, expenseQuantity } = splitResult;

  // Replace the splits atomically: wipe the old rows, update the expense with fresh ones nested
  // in — same deleteMany + recreate shape the settlement "recalculate" flow already established
  let updated;
  try {
    [, updated] = await prisma.$transaction([
      prisma.expenseSplit.deleteMany({ where: { expense_id: expenseId } }),
      prisma.expense.update({
        where: { id: expenseId },
        data: {
          amount,
          description,
          paid_by,
          split_type: body.split_type,
          quantity: expenseQuantity,
          splits: { create: splitRows },
        },
        include: { payer: true, splits: { include: { participant: true } } },
      }),
    ]);
  } catch (err) {
    // The expense can vanish between the existence check above and this transaction (e.g.
    // another participant deleting it concurrently) — Prisma throws P2025 for an update
    // targeting a row that's gone; treat that the same as the "not found" case above
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "expense not found in this session" }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json(serializeExpense(updated));
}

// DELETE /api/sessions/:sessionId/expenses/:expenseId — remove a mistaken or duplicate expense
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; expenseId: string }> },
) {
  const { sessionId, expenseId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  // Scope the lookup to this session too, so you can't delete another session's expense by id
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, session_id: sessionId },
  });
  if (!expense) {
    return NextResponse.json({ error: "expense not found in this session" }, { status: 404 });
  }

  // onDelete: Cascade on ExpenseSplit means its rows are removed in the same operation
  await prisma.expense.delete({ where: { id: expenseId } });

  return new NextResponse(null, { status: 204 });
}
