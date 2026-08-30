import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireValidSessionId } from "@/lib/validation";
import { serializeSettlement } from "@/lib/serialize";
import { parseBody } from "@/lib/requestBody";
import { updateSettlementSchema } from "@/schemas/sessions";
import { isMissingRowError } from "@/lib/prismaErrors";

// The lookup miss and the lost-row catch below answer with this
const SETTLEMENT_NOT_FOUND_MESSAGE = "settlement not found in this session";

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
    return NextResponse.json({ error: SETTLEMENT_NOT_FOUND_MESSAGE }, { status: 404 });
  }

  let updated;
  try {
    updated = await prisma.settlement.update({
      where: { id: settlementId },
      data: { paid },
      include: { debtor: true, creditor: true },
    });
  } catch (err) {
    // POST /settlements deletes every row in the session before recreating them, so the row found
    // above can vanish mid-request — same answer as the not-found case above
    if (isMissingRowError(err)) {
      return NextResponse.json({ error: SETTLEMENT_NOT_FOUND_MESSAGE }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json(serializeSettlement(updated));
}
