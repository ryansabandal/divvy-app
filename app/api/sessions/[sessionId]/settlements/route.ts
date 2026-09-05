import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireValidSessionId } from "@/lib/validation";
import { computeSettlements } from "@/lib/settle";
import { computeNetBalances, settlementPlansMatch } from "@/lib/settlementHelpers";
import { serializeSettlement } from "@/lib/serialize";

// GET /api/sessions/:sessionId/settlements — the settlement plan for this session.
// If a plan has been frozen (locked in), return those stored rows with their paid state;
// otherwise return a fresh, unsaved preview computed from the current expenses.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: true,
      expenses: { include: { splits: true } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // Names for every participant in this session — already loaded above, so serializing a
  // settlement never needs its own debtor/creditor relation query
  const participantsById = new Map(session.participants.map((p) => [p.id, p]));

  // A frozen plan, once it exists, is the source of truth — return it with paid flags + names.
  // Ordered by sort_order (insertion order), not left to Postgres: an UPDATE — e.g. marking a
  // row paid — can otherwise change physical row order out from under the list.
  const frozen = await prisma.settlement.findMany({
    where: { session_id: sessionId },
    orderBy: { sort_order: "asc" },
  });
  if (frozen.length > 0) {
    // Also compute what the live plan looks like today so we can flag staleness if expenses changed
    const balances = computeNetBalances(session.participants, session.expenses);
    const livePlan = computeSettlements(balances);
    const stale = !settlementPlansMatch(frozen, livePlan);
    const withNames = frozen.map((s) => ({
      ...s,
      debtor: { name: participantsById.get(s.from_id)?.name ?? "" },
      creditor: { name: participantsById.get(s.to_id)?.name ?? "" },
    }));
    return NextResponse.json({ frozen: true, stale, settlements: withNames.map(serializeSettlement) });
  }

  // No frozen plan yet — compute a preview from current balances (not saved to the DB)
  const balances = computeNetBalances(session.participants, session.expenses);
  const settlements = computeSettlements(balances).map((s) => ({
    from_id: s.from_id,
    from_name: participantsById.get(s.from_id)?.name,
    to_id: s.to_id,
    to_name: participantsById.get(s.to_id)?.name,
    amount: s.amount,
  }));

  return NextResponse.json({ frozen: false, stale: false, settlements });
}

// POST /api/sessions/:sessionId/settlements — freeze (lock in) the current plan so payments can
// be marked off as paid. Recomputes from current expenses and replaces any previously frozen
// plan, which is also how "recalculate" works: re-freezing wipes the old plan and its paid state.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      participants: true,
      expenses: { include: { splits: true } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // Compute the minimized plan we're about to persist
  const balances = computeNetBalances(session.participants, session.expenses);
  const plan = computeSettlements(balances);
  // Names for every participant in this session — already loaded above
  const participantsById = new Map(session.participants.map((p) => [p.id, p]));

  // Replace any existing frozen plan atomically: clear the old rows, then insert the new ones.
  // createManyAndReturn hands back the inserted rows (with generated id + sort_order) in one
  // call, so there's no third query just to re-read what was written.
  const [, created] = await prisma.$transaction([
    prisma.settlement.deleteMany({ where: { session_id: sessionId } }),
    prisma.settlement.createManyAndReturn({
      data: plan.map((s) => ({
        session_id: sessionId,
        from_id: s.from_id,
        to_id: s.to_id,
        amount: s.amount,
      })),
    }),
  ]);

  // Sort explicitly rather than trust createManyAndReturn's row order — the same "don't leave
  // order unspecified" lesson h08 exists for applies here too
  const withNames = [...created].sort((a, b) => a.sort_order - b.sort_order).map((s) => ({
    ...s,
    debtor: { name: participantsById.get(s.from_id)?.name ?? "" },
    creditor: { name: participantsById.get(s.to_id)?.name ?? "" },
  }));
  return NextResponse.json({ frozen: true, settlements: withNames.map(serializeSettlement) }, { status: 201 });
}
