import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireValidSessionId } from "@/lib/validation";
import { serializeParticipant } from "@/lib/serialize";
import { addParticipantSchema } from "@/schemas/sessions";
import { parseBody } from "@/lib/requestBody";

// POST /api/sessions/:sessionId/participants — add one participant to an existing session
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const parseResult = await parseBody(request, addParticipantSchema);
  if (!parseResult.ok) return parseResult.response;
  const { name } = parseResult.data;

  // Confirm the parent session exists before attaching a participant to it
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const participant = await prisma.participant.create({
    data: { name, session_id: sessionId },
  });

  return NextResponse.json(serializeParticipant(participant), { status: 201 });
}
