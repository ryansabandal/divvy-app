import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireValidSessionId } from "@/lib/validation";
import { serializeParticipant, serializeExpense } from "@/lib/serialize";

// GET /api/sessions/:sessionId — fetch a session with everything needed to render it
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  // A malformed id can never match a row — reject it up front instead of letting it reach
  // Postgres as a raw "invalid input syntax" error
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: { orderBy: { sort_order: "asc" } },
      expenses: {
        orderBy: { sort_order: "asc" },
        include: {
          payer: true,
          splits: { include: { participant: true } },
        },
      },
    },
  });

  // findUnique returns null rather than throwing when nothing matches
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: session.id,
    name: session.name,
    participants: session.participants.map(serializeParticipant),
    expenses: session.expenses.map(serializeExpense),
  });
}
