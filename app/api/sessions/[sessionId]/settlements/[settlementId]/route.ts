import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireValidSessionId } from "@/lib/validation";
import { serializeSettlement } from "@/lib/serialize";
import { parseBody } from "@/lib/requestBody";
import { updateSettlementSchema } from "@/schemas/sessions";

// PATCH /api/sessions/:sessionId/settlements/:settlementId — mark one frozen payment paid/unpaid
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; settlementId: string }> },
) {
  const { sessionId, settlementId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const parsed = await parseBody(request, updateSettlementSchema);
  if (!parsed.ok) return parsed.response;
  const { paid } = parsed.data;

  // Scope to this session so you can't flip another session's settlement by id. No UUID gate
  // on :settlementId — the id column is TEXT, so an arbitrary string is a legal (non-matching)
  // value and 404s cleanly.
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, session_id: sessionId },
  });
  if (!settlement) {
    return NextResponse.json({ error: "settlement not found in this session" }, { status: 404 });
  }

  const updated = await prisma.settlement.update({
    where: { id: settlementId },
    data: { paid },
    include: { debtor: true, creditor: true },
  });

  return NextResponse.json(serializeSettlement(updated));
}
