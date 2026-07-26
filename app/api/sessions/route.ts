import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSessionSchema } from "@/schemas/sessions";
import { serializeParticipant } from "@/lib/serialize";
import { parseBody } from "@/lib/requestBody";

// POST /api/sessions — create a session and its initial participants together
export async function POST(request: Request) {
  // Validate at the boundary: rejects bad shape (e.g. empty names, missing fields) before it reaches Prisma
  const parseResult = await parseBody(request, createSessionSchema);
  if (!parseResult.ok) return parseResult.response;
  const { name, participants } = parseResult.data;

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

  return NextResponse.json(
    {
      id: session.id,
      name: session.name,
      participants: session.participants.map(serializeParticipant),
    },
    { status: 201 },
  );
}
