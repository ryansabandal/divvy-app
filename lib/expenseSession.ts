import { NextResponse } from "next/server";
import { prisma } from "./db";

// Shared by expense POST (create) and PATCH (edit): both need the parent session to exist and
// need to know which participant ids belong to it. One home instead of two duplicated ~10-line copies.
export type LoadSessionResult =
  | { ok: true; participantIdsInSession: Set<string> }
  | { ok: false; response: NextResponse };

export async function loadSessionParticipants(sessionId: string): Promise<LoadSessionResult> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { participants: true },
  });
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "session not found" }, { status: 404 }) };
  }
  return { ok: true, participantIdsInSession: new Set(session.participants.map((p) => p.id)) };
}

// Kept separate from loadSessionParticipants (rather than folded into one combined check) so
// callers can interleave it with their own lookups — the expense-edit PATCH route needs its
// existing-expense 404 to fire before this 400, matching the original Express check order.
export function validatePayer(participantIdsInSession: Set<string>, paidBy: string): NextResponse | null {
  if (participantIdsInSession.has(paidBy)) return null;
  return NextResponse.json({ error: "paid_by must be a participant in this session" }, { status: 400 });
}
