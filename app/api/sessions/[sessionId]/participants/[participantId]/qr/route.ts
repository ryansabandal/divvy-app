import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireValidSessionId } from "@/lib/validation";
import { createQrUploadUrl, deleteStorageObject, qrObjectPrefix } from "@/lib/storage";
import { publicObjectUrl } from "@/lib/storageUrl";
import { setQrObjectPathSchema } from "@/schemas/sessions";
import { parseBody } from "@/lib/requestBody";

// Scope the participant lookup to this session, same pattern as PATCH .../participants/:participantId.
// No UUID gate on :participantId — the id column is TEXT, so an arbitrary string is a legal
// (non-matching) value and 404s cleanly via findFirst.
async function findParticipantInSession(sessionId: string, participantId: string) {
  return prisma.participant.findFirst({ where: { id: participantId, session_id: sessionId } });
}

// POST /api/sessions/:sessionId/participants/:participantId/qr — mint a signed upload URL for a
// new QR image. Takes no body: the upload pipeline (lib/imageCompress.ts) always outputs JPEG, so
// there's no client-supplied content-type to trust or derive an extension from.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; participantId: string }> },
) {
  const { sessionId, participantId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const participant = await findParticipantInSession(sessionId, participantId);
  if (!participant) {
    return NextResponse.json({ error: "participant not found in this session" }, { status: 404 });
  }

  const { path, signedUrl } = await createQrUploadUrl(sessionId);
  return NextResponse.json({ path, signed_url: signedUrl });
}

// PUT /api/sessions/:sessionId/participants/:participantId/qr — persist the object path after the
// client's direct-to-Storage upload (via the signed URL from POST above) succeeds
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; participantId: string }> },
) {
  const { sessionId, participantId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const parseResult = await parseBody(request, setQrObjectPathSchema);
  if (!parseResult.ok) return parseResult.response;
  const { path } = parseResult.data;

  // The one genuinely new attack surface in this feature: without this check, a caller could mint
  // a signed URL for their own session and then point another participant's row — in any session —
  // at an arbitrary object path. qrObjectPrefix() is the single source of truth for this session's
  // folder, shared with the mint above, so the two can never drift apart.
  if (!path.startsWith(qrObjectPrefix(sessionId))) {
    return NextResponse.json({ error: "path is not scoped to this session" }, { status: 400 });
  }

  const participant = await findParticipantInSession(sessionId, participantId);
  if (!participant) {
    return NextResponse.json({ error: "participant not found in this session" }, { status: 404 });
  }

  // Replacing an existing QR: delete the old object so it doesn't sit in Storage forever counting
  // against the free-tier cap. A failure here isn't fatal to the request — the new path still wins.
  if (participant.qr_object_path) {
    await deleteStorageObject(participant.qr_object_path);
  }

  await prisma.participant.update({ where: { id: participantId }, data: { qr_object_path: path } });

  return NextResponse.json({ qr_code_url: publicObjectUrl(path) });
}

// DELETE /api/sessions/:sessionId/participants/:participantId/qr — remove a participant's QR code
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; participantId: string }> },
) {
  const { sessionId, participantId } = await params;
  const invalidIdResponse = requireValidSessionId(sessionId);
  if (invalidIdResponse) return invalidIdResponse;

  const participant = await findParticipantInSession(sessionId, participantId);
  if (!participant) {
    return NextResponse.json({ error: "participant not found in this session" }, { status: 404 });
  }
  if (!participant.qr_object_path) {
    return NextResponse.json({ error: "participant has no QR code to remove" }, { status: 404 });
  }

  await deleteStorageObject(participant.qr_object_path);
  await prisma.participant.update({ where: { id: participantId }, data: { qr_object_path: null } });

  return new NextResponse(null, { status: 204 });
}
