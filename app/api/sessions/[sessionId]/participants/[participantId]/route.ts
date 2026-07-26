import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireValidSessionId } from "@/lib/validation";
import { serializeParticipant } from "@/lib/serialize";
import { setPaymentMethodSchema } from "@/schemas/sessions";
import { parseBody } from "@/lib/requestBody";

// PATCH /api/sessions/:sessionId/participants/:participantId — a participant sets their own payment method
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; participantId: string }> },
) {
  const { sessionId, participantId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const parseResult = await parseBody(request, setPaymentMethodSchema);
  if (!parseResult.ok) return parseResult.response;
  const { payment_method_type, payment_details } = parseResult.data;

  // Scope the lookup to this session, same pattern as the expense delete route. No UUID gate on
  // :participantId — the id column is TEXT, so an arbitrary string is a legal (non-matching) value
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, session_id: sessionId },
  });
  if (!participant) {
    return NextResponse.json({ error: "participant not found in this session" }, { status: 404 });
  }

  const updated = await prisma.participant.update({
    where: { id: participantId },
    data: { payment_method_type, payment_details },
  });

  return NextResponse.json(serializeParticipant(updated));
}
