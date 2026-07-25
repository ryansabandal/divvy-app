// Integration tests for the /api/sessions routes.
//
// These talk to a RUNNING server over real HTTP — they never import the Express app. That's
// deliberate: the same suite has to keep working after the routes are ported to Next.js Route
// Handlers, so it must not depend on any framework internals. Point TEST_BASE_URL at whichever
// backend is running and the assertions below stay identical.
//
// Requires: Postgres up (podman-compose up -d) and the API running (npm run dev).
// Run with:  npm run test:integration

import { describe, it, expect } from "vitest";

// Which server to test. Express dev server today; http://localhost:3000 after the Next.js port.
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:4000";

// One small wrapper around fetch so every test reads as "call this path, get back status + body".
// Returns the parsed body, or null for empty responses (DELETE returns 204 with no body).
async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    // Spread init.headers last so an individual test could override the content type if needed
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  // 204 (and any empty response) has no JSON to parse — read as text first to stay safe
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// POST helper — every test that needs a session starts by making its own, which is what keeps
// tests isolated from each other: all routes are session-scoped, so separate sessions can't collide.
async function createSession(
  name = "Test dinner",
  participants = ["Alice", "Bob", "Carol"],
) {
  const { status, body } = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ name, participants }),
  });
  // Fail loudly here rather than in the test that depended on it
  expect(status).toBe(201);
  return body;
}

describe("POST /api/sessions", () => {
  it("creates a session with its participants and returns 201", async () => {
    const { status, body } = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Friday dinner", participants: ["Alice", "Bob"] }),
    });

    expect(status).toBe(201);
    expect(body.name).toBe("Friday dinner");
    // The id is generated server-side, so assert its shape rather than a fixed value
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.participants).toHaveLength(2);
    expect(body.participants.map((p: any) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("returns participants in the order they were supplied", async () => {
    // Guards the sort_order mechanism: created_at can't order these because a nested write
    // gives every row the same transaction timestamp
    const names = ["Zoe", "Adam", "Mia", "Ben"];
    const session = await createSession("Ordering check", names);
    expect(session.participants.map((p: any) => p.name)).toEqual(names);
  });

  it("does not leak internal database columns", async () => {
    // serializeParticipant deliberately drops sort_order, created_at and session_id —
    // locking that in so the port can't silently start returning raw Prisma rows again
    const session = await createSession();
    for (const participant of session.participants) {
      expect(Object.keys(participant).sort()).toEqual([
        "id",
        "name",
        "payment_details",
        "payment_method_type",
      ]);
    }
  });

  it("starts participants with no payment method set", async () => {
    const session = await createSession();
    expect(session.participants[0].payment_method_type).toBeNull();
    expect(session.participants[0].payment_details).toBeNull();
  });

  it("trims surrounding whitespace from the session and participant names", async () => {
    const session = await createSession("  Padded name  ", ["  Alice  ", "Bob"]);
    expect(session.name).toBe("Padded name");
    expect(session.participants[0].name).toBe("Alice");
  });

  it("rejects an empty session name", async () => {
    const { status } = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "", participants: ["Alice"] }),
    });
    expect(status).toBe(400);
  });

  it("rejects a whitespace-only session name", async () => {
    const { status } = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "   ", participants: ["Alice"] }),
    });
    expect(status).toBe(400);
  });

  it("rejects an empty participants array", async () => {
    const { status } = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Solo bill", participants: [] }),
    });
    expect(status).toBe(400);
  });

  it("rejects a participant with an empty name", async () => {
    // The original bug: the route only checked the array was non-empty, so ["", null] reached Prisma
    const { status } = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Dinner", participants: ["Alice", ""] }),
    });
    expect(status).toBe(400);
  });

  it("rejects more than 50 participants", async () => {
    // Upper bound added during the hardening pass — one request could otherwise nest unbounded rows
    const tooMany = Array.from({ length: 51 }, (_, i) => `Person ${i}`);
    const { status } = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Huge party", participants: tooMany }),
    });
    expect(status).toBe(400);
  });

  it("rejects a name longer than 100 characters", async () => {
    const { status } = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "x".repeat(101), participants: ["Alice"] }),
    });
    expect(status).toBe(400);
  });
});

describe("GET /api/sessions/:sessionId", () => {
  it("returns the session with its participants and an empty expense list", async () => {
    const created = await createSession("Lunch", ["Alice", "Bob"]);

    const { status, body } = await api(`/api/sessions/${created.id}`);

    expect(status).toBe(200);
    expect(body.id).toBe(created.id);
    expect(body.name).toBe("Lunch");
    expect(body.participants).toHaveLength(2);
    // A brand-new session has no expenses yet, but the key must still be present as an array
    expect(body.expenses).toEqual([]);
  });

  it("returns 404 for a well-formed UUID that doesn't exist", async () => {
    const { status, body } = await api("/api/sessions/00000000-0000-4000-8000-000000000000");
    expect(status).toBe(404);
    expect(body.error).toBe("session not found");
  });

  it("returns 404 (not 500) for a malformed session id", async () => {
    // Regression cover for the audit fix: a non-UUID used to reach Postgres as a raw
    // "invalid input syntax for type uuid" error and surface as a 500. The router's
    // param() gate now rejects it up front.
    const { status, body } = await api("/api/sessions/not-a-uuid");
    expect(status).toBe(404);
    expect(body.error).toBe("session not found");
  });
});
