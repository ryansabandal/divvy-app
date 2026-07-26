import { NextResponse } from "next/server";

// Matches an RFC 4122 UUID — session/expense/participant/settlement ids are always one of
// these. Express used a router.param() gate to turn a malformed id into a 404 before any
// handler ran; Route Handlers have no equivalent middleware hook, so each handler calls this directly.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return UUID_RE.test(id);
}

// Every handler with a :sessionId segment needs the same malformed-id-> 404 gate. Returns the
// 404 response to return immediately, or null if the id is well-formed and the handler should proceed.
export function requireValidSessionId(sessionId: string): NextResponse | null {
  if (isValidUuid(sessionId)) return null;
  return NextResponse.json({ error: "session not found" }, { status: 404 });
}
