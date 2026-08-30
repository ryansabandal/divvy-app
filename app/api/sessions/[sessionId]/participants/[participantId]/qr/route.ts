import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireValidSessionId } from "@/lib/validation";
import { createQrUploadUrl, deleteStorageObjectBestEffort, isMintedQrPath } from "@/lib/storage";
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

  // Without this check, a caller could mint a signed URL for their own session and then point
  // another participant's row — in any session — at an arbitrary object path
  if (!isMintedQrPath(sessionId, path)) {
    return NextResponse.json({ error: "path is not scoped to this session" }, { status: 400 });
  }

  const participant = await findParticipantInSession(sessionId, participantId);
  if (!participant) {
    return NextResponse.json({ error: "participant not found in this session" }, { status: 404 });
  }

  const previousPath = participant.qr_object_path;

  // Persist first, so the new path wins unconditionally regardless of what happens to the old
  // object below.
  await prisma.participant.update({ where: { id: participantId }, data: { qr_object_path: path } });

  // Best-effort cleanup of the replaced object, so it doesn't sit in Storage forever counting
  // against the free-tier cap. Skip entirely when the path is unchanged — a retried PUT (network
  // timeout, browser retry) pointing at the same path would otherwise delete the very object the
  // row now references. deleteStorageObjectBestEffort never throws and gives up after its own
  // timeout, so a delete failure — or a hang — adds at most that bound to this response and can
  // never turn an already-successful persist into an error; an orphaned object is the accepted
  // failure mode (CLAUDE.md's V2 constraints).
  if (previousPath && previousPath !== path) {
    await deleteStorageObjectBestEffort(previousPath);
  }

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

  const previousPath = participant.qr_object_path;

  // Same ordering as PUT above (ticket 02): clear the row first so it wins unconditionally, then
  // best-effort delete the object — never blocks or fails this response.
  await prisma.participant.update({ where: { id: participantId }, data: { qr_object_path: null } });
  await deleteStorageObjectBestEffort(previousPath);

  return new NextResponse(null, { status: 204 });
}
