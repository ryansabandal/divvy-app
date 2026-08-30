// Integration tests for the /api/sessions routes.
//
// These talk to a RUNNING server over real HTTP — they never import the Express app. That's
// deliberate: the same suite has to keep working after the routes are ported to Next.js Route
// Handlers, so it must not depend on any framework internals. Point TEST_BASE_URL at whichever
// backend is running and the assertions below stay identical.
//
// Requires: Postgres up (podman-compose up -d) and the API running (npm run dev).
// Run with:  npm run test:integration

import "dotenv/config";
import { describe, it, expect } from "vitest";

// Which server to test. Defaults to the Next.js dev server; override via TEST_BASE_URL to point
// at a Vercel preview/production URL instead.
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

// Whether this run has Supabase Storage configured — read from the same .env the server under
// test loads (via "dotenv/config" above). Without these, the QR routes error out at the real
// Supabase client call, so that suite skips itself rather than failing on a fresh clone that
// has no Storage keys yet. Skipped tests still show up as "skipped" in vitest's output, so this
// isn't a silent pass.
const STORAGE_CONFIGURED = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_STORAGE_BUCKET,
);
if (!STORAGE_CONFIGURED) {
  console.warn("Skipping QR upload integration tests — SUPABASE_* env vars not set.");
}

// One small wrapper around fetch so every test reads as "call this path, get back status + body".
// Returns the parsed body, or null for empty responses (DELETE returns 204 with no body).
async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    // Spread init.headers last so an individual test could override the content type if needed
    headers: {
      "Content-Type": "application/json",
      // Vercel Preview deployments sit behind Deployment Protection (SSO) — this header bypasses
      // it for automated requests. No-op when unset, i.e. against local dev or Production.
      ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
        : {}),
      ...init?.headers,
    },
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
        "qr_code_url",
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

describe("POST /api/sessions/:sessionId/participants", () => {
  it("adds a participant to an existing session and returns 201", async () => {
    const session = await createSession();

    const { status, body } = await api(`/api/sessions/${session.id}/participants`, {
      method: "POST",
      body: JSON.stringify({ name: "Dave" }),
    });

    expect(status).toBe(201);
    expect(body.name).toBe("Dave");
    expect(body.payment_method_type).toBeNull();
    expect(body.payment_details).toBeNull();
  });

  it("trims whitespace from the new participant's name", async () => {
    const session = await createSession();
    const { body } = await api(`/api/sessions/${session.id}/participants`, {
      method: "POST",
      body: JSON.stringify({ name: "  Dave  " }),
    });
    expect(body.name).toBe("Dave");
  });

  it("does not leak internal database columns", async () => {
    const session = await createSession();
    const { body } = await api(`/api/sessions/${session.id}/participants`, {
      method: "POST",
      body: JSON.stringify({ name: "Dave" }),
    });
    expect(Object.keys(body).sort()).toEqual([
      "id",
      "name",
      "payment_details",
      "payment_method_type",
      "qr_code_url",
    ]);
  });

  it("returns 404 when the session doesn't exist", async () => {
    const { status } = await api(
      "/api/sessions/00000000-0000-4000-8000-000000000000/participants",
      { method: "POST", body: JSON.stringify({ name: "Dave" }) },
    );
    expect(status).toBe(404);
  });

  it("rejects an empty name", async () => {
    const session = await createSession();
    const { status } = await api(`/api/sessions/${session.id}/participants`, {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    expect(status).toBe(400);
  });

  it("rejects a whitespace-only name", async () => {
    const session = await createSession();
    const { status } = await api(`/api/sessions/${session.id}/participants`, {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    expect(status).toBe(400);
  });

  // Tickets 06 (inconsistent validation) + 18 (missing max-length) — this route now validates
  // via addParticipantSchema (Zod), which caps name at 100 chars same as createSessionSchema.
  it("rejects a name over the 100-char max-length cap", async () => {
    const session = await createSession();
    const { status } = await api(`/api/sessions/${session.id}/participants`, {
      method: "POST",
      body: JSON.stringify({ name: "x".repeat(500) }),
    });
    expect(status).toBe(400);
  });
});

describe("PATCH /api/sessions/:sessionId/participants/:participantId", () => {
  it("sets a GCASH payment method", async () => {
    const session = await createSession();
    const participant = session.participants[0];

    const { status, body } = await api(
      `/api/sessions/${session.id}/participants/${participant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ payment_method_type: "GCASH", payment_details: "09171234567" }),
      },
    );

    expect(status).toBe(200);
    expect(body.payment_method_type).toBe("GCASH");
    expect(body.payment_details).toBe("09171234567");
  });

  it("sets a BANK_TRANSFER payment method, stored as 'Bank Name - Account Number'", async () => {
    // Encoding owned by frontend/lib/paymentDetails.ts — the route itself just stores
    // whatever string it's given, so this pins the contract the frontend depends on.
    const session = await createSession();
    const participant = session.participants[0];

    const { body } = await api(
      `/api/sessions/${session.id}/participants/${participant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ payment_method_type: "BANK_TRANSFER", payment_details: "BPI - 1234567890" }),
      },
    );

    expect(body.payment_details).toBe("BPI - 1234567890");
  });

  it("returns 404 when the participant doesn't belong to this session", async () => {
    // Two different sessions — confirms the lookup is scoped by session_id, not just participant id
    const sessionA = await createSession();
    const sessionB = await createSession();
    const participantFromB = sessionB.participants[0];

    const { status } = await api(
      `/api/sessions/${sessionA.id}/participants/${participantFromB.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ payment_method_type: "GCASH", payment_details: "0917" }),
      },
    );

    expect(status).toBe(404);
  });

  // Unlike :sessionId, there's no router.param() UUID gate on :participantId — it flows straight
  // into a scoped findFirst(). Since the id column is TEXT (not a native Postgres uuid type),
  // an arbitrary string is a legal query value that just finds no row, so this already 404s
  // cleanly today. Pinning it so a port can't regress into the same bug class fixed for sessionId.
  it("returns 404 (not 500) for a malformed participant id", async () => {
    const session = await createSession();
    const { status } = await api(
      `/api/sessions/${session.id}/participants/not-a-uuid`,
      {
        method: "PATCH",
        body: JSON.stringify({ payment_method_type: "GCASH", payment_details: "0917" }),
      },
    );
    expect(status).toBe(404);
  });

  it("rejects a payment_method_type outside the enum", async () => {
    const session = await createSession();
    const participant = session.participants[0];

    const { status } = await api(
      `/api/sessions/${session.id}/participants/${participant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ payment_method_type: "PAYPAL", payment_details: "x" }),
      },
    );

    expect(status).toBe(400);
  });

  it("rejects empty payment_details", async () => {
    const session = await createSession();
    const participant = session.participants[0];

    const { status } = await api(
      `/api/sessions/${session.id}/participants/${participant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ payment_method_type: "GCASH", payment_details: "" }),
      },
    );

    expect(status).toBe(400);
  });

  // Ticket 18 — this route now validates via setPaymentMethodSchema (Zod), which caps
  // payment_details at 200 chars.
  it("rejects payment_details over the 200-char max-length cap", async () => {
    const session = await createSession();
    const participant = session.participants[0];

    const { status } = await api(
      `/api/sessions/${session.id}/participants/${participant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ payment_method_type: "GCASH", payment_details: "9".repeat(1000) }),
      },
    );

    expect(status).toBe(400);
  });
});

// Small helper: create a session with N participants named P0..P{n-1}, return session + ids in order.
// Expense tests care about *which* participant owes what, so having stable, predictable ids
// to reference (session.participants[0].id, etc.) keeps each test's assertions readable.
async function createSessionWithParticipants(count: number) {
  const names = Array.from({ length: count }, (_, i) => `P${i}`);
  return createSession("Expense test session", names);
}

describe("POST /api/sessions/:sessionId/expenses — EVEN split", () => {
  it("splits evenly across the chosen participants and returns 201", async () => {
    const session = await createSessionWithParticipants(3);
    const [a, b, c] = session.participants;

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Dinner",
        amount: 300,
        paid_by: a.id,
        split_type: "EVEN",
        participant_ids: [a.id, b.id, c.id],
      }),
    });

    expect(status).toBe(201);
    expect(body.description).toBe("Dinner");
    expect(body.split_type).toBe("EVEN");
    // serializeExpense only fills in quantity for QUANTITY splits — EVEN/CUSTOM should be null
    expect(body.quantity).toBeNull();
    // 300 / 3 participants — divides evenly, so there is no leftover centavo to hand out
    const amounts = body.splits.map((s: any) => s.amount_owed).sort((x: number, y: number) => x - y);
    expect(amounts).toEqual([100, 100, 100]);
  });

  // The session-existence check runs before any split-type branching, so one test covers
  // this for CUSTOM and QUANTITY too — it's the same code path regardless of split_type.
  it("returns 404 when the session doesn't exist", async () => {
    const { status } = await api(
      "/api/sessions/00000000-0000-4000-8000-000000000000/expenses",
      {
        method: "POST",
        body: JSON.stringify({
          description: "Ghost session",
          amount: 100,
          paid_by: "00000000-0000-4000-8000-000000000001",
          split_type: "EVEN",
          participant_ids: ["00000000-0000-4000-8000-000000000001"],
        }),
      },
    );
    expect(status).toBe(404);
  });

  it("does not leak internal database columns", async () => {
    // serializeExpense/serializeExpenseSplit drop session_id, expense_id, and the raw paid_by
    // id — locking in the shape so a port can't silently start returning raw Prisma rows again
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;

    const { body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Shape check",
        amount: 100,
        paid_by: a.id,
        split_type: "EVEN",
        participant_ids: [a.id, b.id],
      }),
    });

    expect(Object.keys(body).sort()).toEqual([
      "amount",
      "description",
      "id",
      "payer",
      "quantity",
      "split_type",
      "splits",
    ]);
    expect(Object.keys(body.splits[0]).sort()).toEqual([
      "amount_owed",
      "id",
      "participant",
      "participant_id",
      "units",
    ]);
  });

  it("hands the leftover centavo to the first participant so the split sums exactly", async () => {
    // 100 / 3 = 33.333... — three whole-centavo shares total 99.99, leaving one centavo,
    // which goes to the participant whose share lost the most to rounding.
    const session = await createSessionWithParticipants(3);
    const [a, b, c] = session.participants;

    const { body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Split three ways",
        amount: 100,
        paid_by: a.id,
        split_type: "EVEN",
        participant_ids: [a.id, b.id, c.id],
      }),
    });

    const byParticipant = new Map(body.splits.map((s: any) => [s.participant_id, s.amount_owed]));
    const total = body.splits.reduce((sum: number, s: any) => sum + s.amount_owed, 0);
    // Exact, not approximate — a half-centavo tolerance would accept a dropped or invented centavo
    expect(total).toBe(100);
    expect(byParticipant.get(a.id)).toBe(33.34);
    expect(byParticipant.get(b.id)).toBe(33.33);
    expect(byParticipant.get(c.id)).toBe(33.33);
  });

  it("rejects a participant_ids entry not in this session", async () => {
    const session = await createSessionWithParticipants(2);
    const outsider = "00000000-0000-4000-8000-000000000000";

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Bad split",
        amount: 100,
        paid_by: session.participants[0].id,
        split_type: "EVEN",
        participant_ids: [session.participants[0].id, outsider],
      }),
    });

    expect(status).toBe(400);
    expect(body.error).toBe("participant_ids must all belong to this session");
  });

  it("rejects a duplicate participant_ids entry", async () => {
    // A repeated id would double-charge that person and inflate the even-share denominator
    const session = await createSessionWithParticipants(2);
    const [a] = session.participants;

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Duplicate",
        amount: 100,
        paid_by: a.id,
        split_type: "EVEN",
        participant_ids: [a.id, a.id],
      }),
    });

    expect(status).toBe(400);
    expect(body.error).toBe("participant_ids must not contain duplicates");
  });

  it("rejects paid_by that isn't a participant in this session", async () => {
    const session = await createSessionWithParticipants(2);
    const outsider = "00000000-0000-4000-8000-000000000000";

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Bad payer",
        amount: 100,
        paid_by: outsider,
        split_type: "EVEN",
        participant_ids: [session.participants[0].id],
      }),
    });

    expect(status).toBe(400);
    expect(body.error).toBe("paid_by must be a participant in this session");
  });
});

describe("POST /api/sessions/:sessionId/expenses — CUSTOM split", () => {
  it("accepts hand-entered amounts that sum exactly to the total", async () => {
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Custom split",
        amount: 100,
        paid_by: a.id,
        split_type: "CUSTOM",
        splits: [
          { participant_id: a.id, amount_owed: 60 },
          { participant_id: b.id, amount_owed: 40 },
        ],
      }),
    });

    expect(status).toBe(201);
    // serializeExpense only fills in quantity for QUANTITY splits
    expect(body.quantity).toBeNull();
    const byParticipant = new Map(body.splits.map((s: any) => [s.participant_id, s.amount_owed]));
    expect(byParticipant.get(a.id)).toBe(60);
    expect(byParticipant.get(b.id)).toBe(40);
  });

  it("accepts amounts within half a centavo of the total (RECONCILED_EPSILON)", async () => {
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;

    const { status } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Tiny float noise",
        amount: 100,
        paid_by: a.id,
        split_type: "CUSTOM",
        splits: [
          { participant_id: a.id, amount_owed: 60.003 },
          { participant_id: b.id, amount_owed: 39.999 },
        ],
      }),
    });

    expect(status).toBe(201);
  });

  // The two tests above/below this line only check comfortably inside/outside 0.005 — neither
  // would notice if RECONCILED_EPSILON itself changed value. These two straddle the actual
  // boundary (0.0049 accepted, 0.0051 rejected) to pin the threshold, not just its neighborhood.
  it("accepts a total exactly at the edge of RECONCILED_EPSILON (0.0049 diff)", async () => {
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;

    const { status } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Just inside the epsilon",
        amount: 100,
        paid_by: a.id,
        split_type: "CUSTOM",
        splits: [
          { participant_id: a.id, amount_owed: 60 },
          { participant_id: b.id, amount_owed: 40.0049 },
        ],
      }),
    });

    expect(status).toBe(201);
  });

  it("rejects a total just past RECONCILED_EPSILON (0.0051 diff)", async () => {
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Just past the epsilon",
        amount: 100,
        paid_by: a.id,
        split_type: "CUSTOM",
        splits: [
          { participant_id: a.id, amount_owed: 60 },
          { participant_id: b.id, amount_owed: 40.0051 },
        ],
      }),
    });

    expect(status).toBe(400);
    expect(body.error).toBe("splits must sum to the expense amount");
  });

  it("rejects amounts that don't sum to the expense total", async () => {
    // Tightened during the hardening pass: CUSTOM splits are hand-entered by a user, so a
    // real mismatch (unlike EVEN/QUANTITY's system-computed rounding) should be rejected
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Off by a peso",
        amount: 100,
        paid_by: a.id,
        split_type: "CUSTOM",
        splits: [
          { participant_id: a.id, amount_owed: 60 },
          { participant_id: b.id, amount_owed: 39 },
        ],
      }),
    });

    expect(status).toBe(400);
    expect(body.error).toBe("splits must sum to the expense amount");
  });

  it("rejects a duplicate participant_id across splits", async () => {
    const session = await createSessionWithParticipants(2);
    const [a] = session.participants;

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Duplicate custom",
        amount: 100,
        paid_by: a.id,
        split_type: "CUSTOM",
        splits: [
          { participant_id: a.id, amount_owed: 50 },
          { participant_id: a.id, amount_owed: 50 },
        ],
      }),
    });

    expect(status).toBe(400);
    expect(body.error).toBe("splits must not contain duplicate participant_ids");
  });

  it("rejects a splits entry whose participant_id isn't in this session", async () => {
    // Mirrors EVEN's "participant_ids must all belong to this session" guard, but CUSTOM
    // validates it as "each split needs a valid participant_id..." — a separate code path
    // (sessions.ts buildExpenseSplits, CUSTOM branch) that had no coverage until now
    const session = await createSessionWithParticipants(2);
    const [a] = session.participants;
    const outsider = "00000000-0000-4000-8000-000000000000";

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Foreign split",
        amount: 100,
        paid_by: a.id,
        split_type: "CUSTOM",
        splits: [
          { participant_id: a.id, amount_owed: 50 },
          { participant_id: outsider, amount_owed: 50 },
        ],
      }),
    });

    expect(status).toBe(400);
    expect(body.error).toBe("each split needs a valid participant_id and a positive amount_owed");
  });
});

describe("POST /api/sessions/:sessionId/expenses — QUANTITY split", () => {
  it("computes each person's share from units consumed", async () => {
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "6 shots",
        amount: 60,
        paid_by: a.id,
        split_type: "QUANTITY",
        quantity: 6,
        splits: [
          { participant_id: a.id, units: 2 },
          { participant_id: b.id, units: 4 },
        ],
      }),
    });

    expect(status).toBe(201);
    expect(body.quantity).toBe(6);
    const byParticipant = new Map(body.splits.map((s: any) => [s.participant_id, s.amount_owed]));
    // Unit price is 60/6 = 10 — a clean division, so there is no leftover centavo here
    expect(byParticipant.get(a.id)).toBe(20);
    expect(byParticipant.get(b.id)).toBe(40);
  });

  it("hands the leftover centavo out the same way as EVEN", async () => {
    // 100 / 3 units = 33.333... per unit — three 1-unit shares come to 33.33 each (99.99 total),
    // leaving one centavo, exercised here through the QUANTITY branch
    const session = await createSessionWithParticipants(3);
    const [a, b, c] = session.participants;

    const { body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Split three ways by quantity",
        amount: 100,
        paid_by: a.id,
        split_type: "QUANTITY",
        quantity: 3,
        splits: [
          { participant_id: a.id, units: 1 },
          { participant_id: b.id, units: 1 },
          { participant_id: c.id, units: 1 },
        ],
      }),
    });

    const byParticipant = new Map(body.splits.map((s: any) => [s.participant_id, s.amount_owed]));
    const total = body.splits.reduce((sum: number, s: any) => sum + s.amount_owed, 0);
    // Exact, as in the EVEN leftover-centavo test above
    expect(total).toBe(100);
    expect(byParticipant.get(a.id)).toBe(33.34);
    expect(byParticipant.get(b.id)).toBe(33.33);
    expect(byParticipant.get(c.id)).toBe(33.33);
  });

  it("rejects units that don't add up to the declared quantity", async () => {
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Mismatched units",
        amount: 60,
        paid_by: a.id,
        split_type: "QUANTITY",
        quantity: 6,
        splits: [
          { participant_id: a.id, units: 2 },
          { participant_id: b.id, units: 3 }, // 2 + 3 = 5, not 6
        ],
      }),
    });

    expect(status).toBe(400);
    expect(body.error).toBe("units add up to 5, but quantity is 6");
  });

  it("rejects a duplicate participant_id across QUANTITY splits", async () => {
    // Same guard shape as CUSTOM's duplicate check, but QUANTITY has its own separate
    // code path (buildExpenseSplits' QUANTITY branch) that had no coverage until now
    const session = await createSessionWithParticipants(2);
    const [a] = session.participants;

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Duplicate quantity",
        amount: 60,
        paid_by: a.id,
        split_type: "QUANTITY",
        quantity: 6,
        splits: [
          { participant_id: a.id, units: 3 },
          { participant_id: a.id, units: 3 },
        ],
      }),
    });

    expect(status).toBe(400);
    expect(body.error).toBe("splits must not contain duplicate participant_ids");
  });

  it("rejects a splits entry whose participant_id isn't in this session", async () => {
    const session = await createSessionWithParticipants(2);
    const [a] = session.participants;
    const outsider = "00000000-0000-4000-8000-000000000000";

    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Foreign quantity",
        amount: 60,
        paid_by: a.id,
        split_type: "QUANTITY",
        quantity: 6,
        splits: [
          { participant_id: a.id, units: 3 },
          { participant_id: outsider, units: 3 },
        ],
      }),
    });

    expect(status).toBe(400);
    expect(body.error).toBe("each split needs a valid participant_id and a positive whole number of units");
  });
});

describe("PATCH /api/sessions/:sessionId/expenses/:expenseId — edit in place", () => {
  async function createEvenExpense(session: any) {
    const [a, b] = session.participants;
    const { body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({
        description: "Original",
        amount: 100,
        paid_by: a.id,
        split_type: "EVEN",
        participant_ids: [a.id, b.id],
      }),
    });
    return body;
  }

  it("replaces the expense's fields and rebuilds its splits", async () => {
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;
    const expense = await createEvenExpense(session);

    const { status, body } = await api(
      `/api/sessions/${session.id}/expenses/${expense.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          description: "Corrected",
          amount: 100,
          paid_by: a.id,
          split_type: "CUSTOM",
          splits: [
            { participant_id: a.id, amount_owed: 70 },
            { participant_id: b.id, amount_owed: 30 },
          ],
        }),
      },
    );

    expect(status).toBe(200);
    expect(body.description).toBe("Corrected");
    expect(body.split_type).toBe("CUSTOM");
    // The route deletes the old ExpenseSplit rows and creates new ones — confirm the old
    // EVEN 50/50 split is gone, not just that a new CUSTOM split was appended alongside it
    expect(body.splits).toHaveLength(2);
    const byParticipant = new Map(body.splits.map((s: any) => [s.participant_id, s.amount_owed]));
    expect(byParticipant.get(a.id)).toBe(70);
    expect(byParticipant.get(b.id)).toBe(30);
  });

  it("returns 404 when the expense doesn't belong to this session", async () => {
    const sessionA = await createSessionWithParticipants(2);
    const sessionB = await createSessionWithParticipants(2);
    const expenseFromB = await createEvenExpense(sessionB);

    const { status } = await api(
      `/api/sessions/${sessionA.id}/expenses/${expenseFromB.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          description: "Hijack attempt",
          amount: 50,
          paid_by: sessionA.participants[0].id,
          split_type: "EVEN",
          participant_ids: [sessionA.participants[0].id],
        }),
      },
    );

    expect(status).toBe(404);
  });

  it("returns 404 for a well-formed but nonexistent expense id", async () => {
    const session = await createSessionWithParticipants(2);
    const { status } = await api(
      `/api/sessions/${session.id}/expenses/00000000-0000-4000-8000-000000000000`,
      {
        method: "PATCH",
        body: JSON.stringify({
          description: "Ghost",
          amount: 50,
          paid_by: session.participants[0].id,
          split_type: "EVEN",
          participant_ids: [session.participants[0].id],
        }),
      },
    );
    expect(status).toBe(404);
  });

  // Same reasoning as the participant equivalent above: no router.param() gate on :expenseId,
  // but the id column is TEXT, so an arbitrary string is a legal (non-matching) query value —
  // this already 404s cleanly today. Pinned so a port can't regress into a 500 here.
  it("returns 404 (not 500) for a malformed expense id", async () => {
    const session = await createSessionWithParticipants(2);
    const { status } = await api(
      `/api/sessions/${session.id}/expenses/not-a-uuid`,
      {
        method: "PATCH",
        body: JSON.stringify({
          description: "Ghost",
          amount: 50,
          paid_by: session.participants[0].id,
          split_type: "EVEN",
          participant_ids: [session.participants[0].id],
        }),
      },
    );
    expect(status).toBe(404);
  });

  // The three tests below prove buildExpenseSplits' validation branches are actually wired
  // into the PATCH handler, not just POST's — the edit route calls the same shared function
  // but through its own call site, and until now only POST's describe blocks exercised it.
  it("rejects a duplicate participant_id in an edit's CUSTOM splits", async () => {
    const session = await createSessionWithParticipants(2);
    const [a] = session.participants;
    const expense = await createEvenExpense(session);

    const { status, body } = await api(
      `/api/sessions/${session.id}/expenses/${expense.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          description: "Duplicate on edit",
          amount: 100,
          paid_by: a.id,
          split_type: "CUSTOM",
          splits: [
            { participant_id: a.id, amount_owed: 50 },
            { participant_id: a.id, amount_owed: 50 },
          ],
        }),
      },
    );

    expect(status).toBe(400);
    expect(body.error).toBe("splits must not contain duplicate participant_ids");
  });

  it("rejects a splits total that doesn't sum to the amended amount", async () => {
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;
    const expense = await createEvenExpense(session);

    const { status, body } = await api(
      `/api/sessions/${session.id}/expenses/${expense.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          description: "Off by a peso on edit",
          amount: 100,
          paid_by: a.id,
          split_type: "CUSTOM",
          splits: [
            { participant_id: a.id, amount_owed: 60 },
            { participant_id: b.id, amount_owed: 39 },
          ],
        }),
      },
    );

    expect(status).toBe(400);
    expect(body.error).toBe("splits must sum to the expense amount");
  });

  it("rejects paid_by that isn't a participant in this session, when editing", async () => {
    const session = await createSessionWithParticipants(2);
    const expense = await createEvenExpense(session);
    const outsider = "00000000-0000-4000-8000-000000000000";

    const { status, body } = await api(
      `/api/sessions/${session.id}/expenses/${expense.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          description: "Bad payer on edit",
          amount: 100,
          paid_by: outsider,
          split_type: "EVEN",
          participant_ids: [session.participants[0].id],
        }),
      },
    );

    expect(status).toBe(400);
    expect(body.error).toBe("paid_by must be a participant in this session");
  });

  it("never 500s when a delete lands concurrently with an edit (ticket 15 regression)", async () => {
    // Ticket 15 (.scratch/v1-hardening-audit/issues/15-edit-route-toctou-500-instead-of-404.md):
    // this route's existence check and its $transaction aren't atomic with each other, so a
    // concurrent DELETE landing in between used to turn a clean 404 into an unhandled 500
    // (Prisma throws P2025 when the transaction's expense.update targets a row that's gone).
    // Fixed by catching P2025 and returning the same 404 every other route uses.
    //
    // That ticket's own resolution notes record that forcing the *exact* race window over HTTP
    // isn't reliably reproducible without injecting an artificial delay into the route itself
    // (deliberately not done, here or there). So rather than pinning one specific winner, this
    // fires both requests concurrently and asserts the invariant the fix actually guarantees:
    // whichever request loses the race gets a clean 404, never a raw 500 — on whichever way
    // the timing happens to land for a given run.
    const session = await createSessionWithParticipants(2);
    const expense = await createEvenExpense(session);

    const [patchResult, deleteResult] = await Promise.all([
      api(`/api/sessions/${session.id}/expenses/${expense.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: "Concurrent edit",
          amount: 100,
          paid_by: session.participants[0].id,
          split_type: "EVEN",
          participant_ids: [session.participants[0].id, session.participants[1].id],
        }),
      }),
      api(`/api/sessions/${session.id}/expenses/${expense.id}`, { method: "DELETE" }),
    ]);

    // The one thing that must never happen, regardless of interleaving
    expect(patchResult.status).not.toBe(500);
    expect(deleteResult.status).not.toBe(500);
    // PATCH either wins the race (200) or loses cleanly (404 — either from the early existence
    // check if DELETE fully completed first, or from the P2025 catch if DELETE's own delete
    // call landed mid-transaction; both are valid outcomes a black-box HTTP test can't and
    // shouldn't try to tell apart)
    expect([200, 404]).toContain(patchResult.status);
    // DELETE's own findFirst+delete never depend on PATCH completing — PATCH only rewrites
    // ExpenseSplit rows and Expense fields, it never removes the Expense row itself — so
    // DELETE succeeds regardless of which way the race lands
    expect(deleteResult.status).toBe(204);
  });
});

describe("PATCH /api/sessions/:sessionId/expenses — bulk reorder", () => {
  it("reassigns sort_order to match the supplied id order", async () => {
    const session = await createSessionWithParticipants(1);
    const payer = session.participants[0];

    // Create three expenses; they'll come back in creation order (1, 2, 3) before reordering
    const one = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "One", amount: 10, paid_by: payer.id, split_type: "EVEN", participant_ids: [payer.id] }),
    });
    const two = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "Two", amount: 10, paid_by: payer.id, split_type: "EVEN", participant_ids: [payer.id] }),
    });
    const three = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "Three", amount: 10, paid_by: payer.id, split_type: "EVEN", participant_ids: [payer.id] }),
    });

    // Reverse the order: Three, One, Two
    const newOrder = [three.body.id, one.body.id, two.body.id];
    const { status, body } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "PATCH",
      body: JSON.stringify({ expense_ids: newOrder }),
    });

    // Ticket 19 — the caller already has the new order, so this returns 204 with no body
    // instead of re-fetching and re-serializing the full expense list. Verify the reorder
    // actually took effect via a follow-up GET rather than trusting the PATCH response.
    expect(status).toBe(204);
    expect(body).toBeNull();

    // Confirm the reorder actually took effect, not just that PATCH returned success
    const after = await api(`/api/sessions/${session.id}`);
    expect(after.body.expenses.map((e: any) => e.id)).toEqual(newOrder);
  });

  it("returns 404 when the session doesn't exist", async () => {
    const { status } = await api(
      "/api/sessions/00000000-0000-4000-8000-000000000000/expenses",
      { method: "PATCH", body: JSON.stringify({ expense_ids: [] }) },
    );
    expect(status).toBe(404);
  });

  it("rejects a partial id list that omits an existing expense", async () => {
    const session = await createSessionWithParticipants(1);
    const payer = session.participants[0];

    const one = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "One", amount: 10, paid_by: payer.id, split_type: "EVEN", participant_ids: [payer.id] }),
    });
    await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "Two", amount: 10, paid_by: payer.id, split_type: "EVEN", participant_ids: [payer.id] }),
    });

    // Omits "Two" entirely — a partial list would silently strand it at its old sort_order
    const { status } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "PATCH",
      body: JSON.stringify({ expense_ids: [one.body.id] }),
    });

    expect(status).toBe(400);
  });

  it("rejects an id from another session mixed into the list", async () => {
    const session = await createSessionWithParticipants(1);
    const otherSession = await createSessionWithParticipants(1);
    const payer = session.participants[0];

    const one = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "One", amount: 10, paid_by: payer.id, split_type: "EVEN", participant_ids: [payer.id] }),
    });
    // Its id is never referenced below — it only needs to exist so session's real expense
    // count is 2, matching the length of the (invalid) list we're about to send
    await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "Two", amount: 10, paid_by: payer.id, split_type: "EVEN", participant_ids: [payer.id] }),
    });
    const foreign = await api(`/api/sessions/${otherSession.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "Foreign", amount: 10, paid_by: otherSession.participants[0].id, split_type: "EVEN", participant_ids: [otherSession.participants[0].id] }),
    });

    // Right length (2, matching session's real expense count), but swaps out "two" for an id
    // belonging to otherSession — isolates the "every id must belong to this session" check
    // specifically, rather than incidentally failing on list length/completeness instead
    const { status } = await api(`/api/sessions/${session.id}/expenses`, {
      method: "PATCH",
      body: JSON.stringify({ expense_ids: [one.body.id, foreign.body.id] }),
    });

    expect(status).toBe(400);
  });
});

describe("DELETE /api/sessions/:sessionId/expenses/:expenseId", () => {
  it("deletes the expense and returns 204", async () => {
    const session = await createSessionWithParticipants(1);
    const payer = session.participants[0];
    const created = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "To delete", amount: 10, paid_by: payer.id, split_type: "EVEN", participant_ids: [payer.id] }),
    });

    const del = await api(`/api/sessions/${session.id}/expenses/${created.body.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    // Confirm it's actually gone, not just that DELETE returned success
    const after = await api(`/api/sessions/${session.id}`);
    expect(after.body.expenses.find((e: any) => e.id === created.body.id)).toBeUndefined();
  });

  it("cascades: the expense's splits are gone too, not just orphaned", async () => {
    // ExpenseSplit has onDelete: Cascade — this proves that config actually works end to end,
    // not just that it's declared in schema.prisma
    const session = await createSessionWithParticipants(2);
    const [a, b] = session.participants;
    const created = await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "Shared", amount: 20, paid_by: a.id, split_type: "EVEN", participant_ids: [a.id, b.id] }),
    });

    await api(`/api/sessions/${session.id}/expenses/${created.body.id}`, { method: "DELETE" });

    // If splits survived as orphans, a fresh GET would still show a nonzero balance for b
    const settlements = await api(`/api/sessions/${session.id}/settlements`);
    expect(settlements.body.settlements).toEqual([]);
  });

  it("returns 404 when the expense doesn't belong to this session", async () => {
    const sessionA = await createSessionWithParticipants(1);
    const sessionB = await createSessionWithParticipants(1);
    const expenseFromB = await api(`/api/sessions/${sessionB.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "B's expense", amount: 10, paid_by: sessionB.participants[0].id, split_type: "EVEN", participant_ids: [sessionB.participants[0].id] }),
    });

    const { status } = await api(`/api/sessions/${sessionA.id}/expenses/${expenseFromB.body.id}`, { method: "DELETE" });
    expect(status).toBe(404);
  });

  // Same reasoning as the malformed-id tests above: no router.param() gate on :expenseId, but
  // the TEXT id column means an arbitrary string is a legal (non-matching) value — 404s cleanly today.
  it("returns 404 (not 500) for a malformed expense id", async () => {
    const session = await createSessionWithParticipants(1);
    const { status } = await api(`/api/sessions/${session.id}/expenses/not-a-uuid`, { method: "DELETE" });
    expect(status).toBe(404);
  });
});

// Shared setup for the settlement tests below: a session where A paid 100, split evenly with B,
// so B owes A 50 and A owes nothing. Every settlement test starts from this same known state.
async function createSessionWithADebt() {
  const session = await createSessionWithParticipants(2);
  const [a, b] = session.participants;
  await api(`/api/sessions/${session.id}/expenses`, {
    method: "POST",
    body: JSON.stringify({ description: "Dinner", amount: 100, paid_by: a.id, split_type: "EVEN", participant_ids: [a.id, b.id] }),
  });
  return { session, a, b };
}

describe("GET /api/sessions/:sessionId/settlements — live preview", () => {
  it("returns an unsaved preview when no plan has been frozen yet", async () => {
    const { session, a, b } = await createSessionWithADebt();

    const { status, body } = await api(`/api/sessions/${session.id}/settlements`);

    expect(status).toBe(200);
    expect(body.frozen).toBe(false);
    expect(body.stale).toBe(false);
    expect(body.settlements).toEqual([
      { from_id: b.id, from_name: "P1", to_id: a.id, to_name: "P0", amount: 50 },
    ]);
  });

  it("returns an empty plan for a session with no expenses", async () => {
    const session = await createSessionWithParticipants(2);
    const { body } = await api(`/api/sessions/${session.id}/settlements`);
    expect(body.settlements).toEqual([]);
  });

  it("returns 404 when the session doesn't exist", async () => {
    const { status } = await api(
      "/api/sessions/00000000-0000-4000-8000-000000000000/settlements",
    );
    expect(status).toBe(404);
  });

  it("recomputes on every call rather than persisting anything", async () => {
    // Calling GET twice in a row must not itself freeze the plan — only POST does that
    const { session } = await createSessionWithADebt();
    await api(`/api/sessions/${session.id}/settlements`);
    const { body } = await api(`/api/sessions/${session.id}/settlements`);
    expect(body.frozen).toBe(false);
  });
});

describe("POST /api/sessions/:sessionId/settlements — freeze the plan", () => {
  it("persists the plan and returns it with paid: false on every row", async () => {
    const { session, a, b } = await createSessionWithADebt();

    const { status, body } = await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });

    expect(status).toBe(201);
    expect(body.frozen).toBe(true);
    expect(body.settlements).toHaveLength(1);
    expect(body.settlements[0]).toMatchObject({ from_id: b.id, to_id: a.id, amount: 50, paid: false });
    // Freezing assigns each row its own persistent id — needed for the later PATCH-by-id call
    expect(body.settlements[0].id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("does not leak internal database columns", async () => {
    // serializeSettlement drops session_id and the full debtor/creditor objects in favor of
    // flat ids + names — locking in the shape so a port can't silently return raw Prisma rows
    const { session } = await createSessionWithADebt();
    const { body } = await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });

    expect(Object.keys(body.settlements[0]).sort()).toEqual([
      "amount",
      "from_id",
      "from_name",
      "id",
      "paid",
      "to_id",
      "to_name",
    ]);
  });

  it("returns 404 when the session doesn't exist", async () => {
    const { status } = await api(
      "/api/sessions/00000000-0000-4000-8000-000000000000/settlements",
      { method: "POST" },
    );
    expect(status).toBe(404);
  });

  it("a subsequent GET returns the same frozen rows, not a fresh computation", async () => {
    const { session } = await createSessionWithADebt();
    const frozen = await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });

    const { body } = await api(`/api/sessions/${session.id}/settlements`);

    expect(body.frozen).toBe(true);
    expect(body.settlements[0].id).toBe(frozen.body.settlements[0].id);
  });

  it("re-POSTing (recalculate) replaces the old plan and resets paid flags", async () => {
    const { session, a, b } = await createSessionWithADebt();
    const first = await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });

    // Mark the original settlement paid, then add a new expense that changes the balances
    await api(`/api/sessions/${session.id}/settlements/${first.body.settlements[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ paid: true }),
    });
    await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "Extra", amount: 20, paid_by: b.id, split_type: "EVEN", participant_ids: [a.id, b.id] }),
    });

    // Recalculate: dinner made A +50/B -50; the extra (paid by B, split evenly) makes B +10/A -10.
    // Net: A +40, B -40 — B still owes A, just 40 instead of 50, a different amount on the same plan.
    const second = await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });

    expect(second.body.settlements).toHaveLength(1);
    expect(second.body.settlements[0]).toMatchObject({ from_id: b.id, to_id: a.id, amount: 40, paid: false });
    // A fresh row, not the old one flipped back to unpaid
    expect(second.body.settlements[0].id).not.toBe(first.body.settlements[0].id);
  });

  it("returns an empty settlements array when balances already net to zero", async () => {
    const session = await createSessionWithParticipants(2);
    const { body } = await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });
    expect(body.settlements).toEqual([]);
  });
});

describe("GET /api/sessions/:sessionId/settlements — stale detection", () => {
  it("flags stale: true when expenses change after the plan was frozen", async () => {
    const { session, a, b } = await createSessionWithADebt();
    await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });

    // Add an expense after freezing — the frozen rows no longer match the live math
    await api(`/api/sessions/${session.id}/expenses`, {
      method: "POST",
      body: JSON.stringify({ description: "Late addition", amount: 20, paid_by: a.id, split_type: "EVEN", participant_ids: [a.id, b.id] }),
    });

    const { body } = await api(`/api/sessions/${session.id}/settlements`);

    expect(body.frozen).toBe(true);
    expect(body.stale).toBe(true);
    // Stale still returns the OLD frozen amount (50), not the new live one — the plan is
    // only flagged as outdated, never silently replaced by a GET
    expect(body.settlements[0].amount).toBe(50);
  });

  it("stays fresh (stale: false) when nothing has changed since freezing", async () => {
    const { session } = await createSessionWithADebt();
    await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });

    const { body } = await api(`/api/sessions/${session.id}/settlements`);

    expect(body.stale).toBe(false);
  });
});

describe("PATCH /api/sessions/:sessionId/settlements/:settlementId — mark paid", () => {
  it("flips a frozen settlement's paid flag to true", async () => {
    const { session } = await createSessionWithADebt();
    const frozen = await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });
    const settlementId = frozen.body.settlements[0].id;

    const { status, body } = await api(
      `/api/sessions/${session.id}/settlements/${settlementId}`,
      { method: "PATCH", body: JSON.stringify({ paid: true }) },
    );

    expect(status).toBe(200);
    expect(body.paid).toBe(true);
  });

  it("flips it back to unpaid", async () => {
    const { session } = await createSessionWithADebt();
    const frozen = await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });
    const settlementId = frozen.body.settlements[0].id;

    await api(`/api/sessions/${session.id}/settlements/${settlementId}`, {
      method: "PATCH",
      body: JSON.stringify({ paid: true }),
    });
    const { body } = await api(`/api/sessions/${session.id}/settlements/${settlementId}`, {
      method: "PATCH",
      body: JSON.stringify({ paid: false }),
    });

    expect(body.paid).toBe(false);
  });

  it("returns 404 when the settlement doesn't belong to this session", async () => {
    const { session: sessionA } = await createSessionWithADebt();
    const { session: sessionB } = await createSessionWithADebt();
    const frozenB = await api(`/api/sessions/${sessionB.id}/settlements`, { method: "POST" });

    const { status } = await api(
      `/api/sessions/${sessionA.id}/settlements/${frozenB.body.settlements[0].id}`,
      { method: "PATCH", body: JSON.stringify({ paid: true }) },
    );

    expect(status).toBe(404);
  });

  // Same reasoning as the earlier malformed-id tests: no router.param() gate on :settlementId,
  // but the TEXT id column means an arbitrary string is a legal (non-matching) value — 404s cleanly today.
  it("returns 404 (not 500) for a malformed settlement id", async () => {
    const { session } = await createSessionWithADebt();
    await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });

    const { status } = await api(
      `/api/sessions/${session.id}/settlements/not-a-uuid`,
      { method: "PATCH", body: JSON.stringify({ paid: true }) },
    );
    expect(status).toBe(404);
  });

  it("rejects a non-boolean paid value", async () => {
    const { session } = await createSessionWithADebt();
    const frozen = await api(`/api/sessions/${session.id}/settlements`, { method: "POST" });

    const { status } = await api(
      `/api/sessions/${session.id}/settlements/${frozen.body.settlements[0].id}`,
      { method: "PATCH", body: JSON.stringify({ paid: "yes" }) },
    );

    expect(status).toBe(400);
  });
});

// Mint a signed upload URL, PUT real bytes to it, then persist the path — the full sequence every
// QR test needs before it can assert on replace/remove behavior. Returns the persisted path so
// callers can assert against it (e.g. that a specific object survived or was deleted).
async function uploadQrForParticipant(sessionId: string, participantId: string): Promise<string> {
  const minted = await api(`/api/sessions/${sessionId}/participants/${participantId}/qr`, { method: "POST" });
  expect(minted.status).toBe(200);

  const uploadRes = await fetch(minted.body.signed_url, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: new Blob([new Uint8Array([1, 2, 3, 4])]),
  });
  expect(uploadRes.ok).toBe(true);

  const persisted = await api(`/api/sessions/${sessionId}/participants/${participantId}/qr`, {
    method: "PUT",
    body: JSON.stringify({ path: minted.body.path }),
  });
  expect(persisted.status).toBe(200);

  return minted.body.path;
}

// These three routes proxy real Supabase Storage (see lib/storage.ts) — no mocking, since the
// signed-URL flow and the bucket's MIME/path enforcement are exactly what needs to be proven end
// to end. Gated by STORAGE_CONFIGURED (above) so a fresh clone without Storage keys still passes.
describe.skipIf(!STORAGE_CONFIGURED)(
  "POST /api/sessions/:sessionId/participants/:participantId/qr — mint upload URL",
  () => {
    it("mints a signed upload URL scoped to this session", async () => {
      const session = await createSessionWithParticipants(1);
      const participant = session.participants[0];

      const { status, body } = await api(
        `/api/sessions/${session.id}/participants/${participant.id}/qr`,
        { method: "POST" },
      );

      expect(status).toBe(200);
      // The path always lives under this session's folder
      expect(body.path).toContain(`qr/${session.id}/`);
      expect(body.signed_url).toMatch(/^https?:\/\//);
    });

    it("returns 404 for a participant that belongs to a different session", async () => {
      const sessionA = await createSessionWithParticipants(1);
      const sessionB = await createSessionWithParticipants(1);
      const participantFromB = sessionB.participants[0];

      const { status } = await api(
        `/api/sessions/${sessionA.id}/participants/${participantFromB.id}/qr`,
        { method: "POST" },
      );

      expect(status).toBe(404);
    });

    it("returns 404 (not 500) for a malformed session id", async () => {
      const { status, body } = await api(
        "/api/sessions/not-a-uuid/participants/00000000-0000-4000-8000-000000000000/qr",
        { method: "POST" },
      );
      expect(status).toBe(404);
      expect(body.error).toBe("session not found");
    });
  },
);

describe.skipIf(!STORAGE_CONFIGURED)(
  "PUT /api/sessions/:sessionId/participants/:participantId/qr — persist after upload",
  () => {
    it("rejects a path outside this session's prefix", async () => {
      // The one genuinely new attack surface in this feature (see route.ts): a caller can't mint
      // a URL for their own session, then point at an arbitrary object path elsewhere.
      const session = await createSessionWithParticipants(1);
      const participant = session.participants[0];

      const { status, body } = await api(
        `/api/sessions/${session.id}/participants/${participant.id}/qr`,
        {
          method: "PUT",
          body: JSON.stringify({ path: "qr/00000000-0000-4000-8000-000000000000/x.jpg" }),
        },
      );

      expect(status).toBe(400);
      expect(body.error).toBe("path is not scoped to this session");
    });

    it("returns 404 when the participant doesn't belong to this session", async () => {
      const sessionA = await createSessionWithParticipants(1);
      const sessionB = await createSessionWithParticipants(1);
      const participantFromB = sessionB.participants[0];

      // A path correctly scoped to sessionA (minted for its own participant) — the point of
      // this test is the participant lookup, not the prefix check, so the path must already
      // pass that check for the 404 to isolate the right thing. Hand-building "qr/<id>/x.jpg"
      // would fail the prefix check whenever SUPABASE_STORAGE_PREFIX is non-empty (e.g. "dev/"
      // locally), which caught this exact bug when this test was first written.
      const minted = await api(
        `/api/sessions/${sessionA.id}/participants/${sessionA.participants[0].id}/qr`,
        { method: "POST" },
      );

      const { status } = await api(
        `/api/sessions/${sessionA.id}/participants/${participantFromB.id}/qr`,
        {
          method: "PUT",
          body: JSON.stringify({ path: minted.body.path }),
        },
      );

      expect(status).toBe(404);
    });

    it("persists the object path and surfaces qr_code_url on the next GET", async () => {
      const session = await createSessionWithParticipants(1);
      const participant = session.participants[0];

      const path = await uploadQrForParticipant(session.id, participant.id);

      const after = await api(`/api/sessions/${session.id}`);
      const afterParticipant = after.body.participants.find((p: any) => p.id === participant.id);
      expect(afterParticipant.qr_code_url).toContain(path);

      // Clean up the real Storage object rather than leaving test data in the bucket forever
      await api(`/api/sessions/${session.id}/participants/${participant.id}/qr`, { method: "DELETE" });
    });

    // Regression coverage for ticket 02: every test above starts from qr_object_path === null, so
    // the replace branch (an existing QR being swapped for a new one) was never exercised.
    it("replaces an existing QR: new object wins, old object is actually deleted", async () => {
      const session = await createSessionWithParticipants(1);
      const participant = session.participants[0];

      const firstPath = await uploadQrForParticipant(session.id, participant.id);
      const secondPath = await uploadQrForParticipant(session.id, participant.id);
      expect(secondPath).not.toBe(firstPath);

      const after = await api(`/api/sessions/${session.id}`);
      const afterParticipant = after.body.participants.find((p: any) => p.id === participant.id);
      expect(afterParticipant.qr_code_url).toContain(secondPath);

      // The old object should be gone from Storage, not just unreferenced — a public-bucket GET
      // for its path should now report "not found" rather than still serving the replaced image.
      // Supabase Storage's public object endpoint has a real quirk here: a missing object comes
      // back as HTTP 400 (not 404), with the semantic status buried in the JSON body instead —
      // confirmed by probing the live endpoint directly, not assumed.
      const oldObjectUrl: string = afterParticipant.qr_code_url.replace(secondPath, firstPath);
      const oldObjectRes = await fetch(oldObjectUrl);
      const oldObjectBody = await oldObjectRes.json();
      expect(oldObjectRes.status).toBe(400);
      expect(oldObjectBody.code).toBe("NoSuchKey");

      await api(`/api/sessions/${session.id}/participants/${participant.id}/qr`, { method: "DELETE" });
    });

    it("same-path replay (retried PUT) leaves the object intact instead of deleting it", async () => {
      // Regression pin for ticket 02's second bug: the old delete-before-update ordering deleted
      // the live object whenever a PUT retried with the same path (e.g. a browser retry after a
      // timeout whose original request actually succeeded server-side).
      const session = await createSessionWithParticipants(1);
      const participant = session.participants[0];

      const path = await uploadQrForParticipant(session.id, participant.id);

      const replay = await api(
        `/api/sessions/${session.id}/participants/${participant.id}/qr`,
        { method: "PUT", body: JSON.stringify({ path }) },
      );
      expect(replay.status).toBe(200);

      const after = await api(`/api/sessions/${session.id}`);
      const afterParticipant = after.body.participants.find((p: any) => p.id === participant.id);
      expect(afterParticipant.qr_code_url).toContain(path);

      // The object itself must still be fetchable — the replay must not have deleted it
      const objectRes = await fetch(afterParticipant.qr_code_url);
      expect(objectRes.status).toBe(200);

      await api(`/api/sessions/${session.id}/participants/${participant.id}/qr`, { method: "DELETE" });
    });
  },
);

describe.skipIf(!STORAGE_CONFIGURED)(
  "DELETE /api/sessions/:sessionId/participants/:participantId/qr — remove",
  () => {
    it("clears qr_object_path back to null and deletes the Storage object", async () => {
      const session = await createSessionWithParticipants(1);
      const participant = session.participants[0];

      await uploadQrForParticipant(session.id, participant.id);

      const del = await api(
        `/api/sessions/${session.id}/participants/${participant.id}/qr`,
        { method: "DELETE" },
      );
      expect(del.status).toBe(204);

      const after = await api(`/api/sessions/${session.id}`);
      const afterParticipant = after.body.participants.find((p: any) => p.id === participant.id);
      expect(afterParticipant.qr_code_url).toBeNull();
    });

    it("returns 404 when the participant has no QR code to remove", async () => {
      const session = await createSessionWithParticipants(1);
      const participant = session.participants[0];

      const { status, body } = await api(
        `/api/sessions/${session.id}/participants/${participant.id}/qr`,
        { method: "DELETE" },
      );

      expect(status).toBe(404);
      expect(body.error).toBe("participant has no QR code to remove");
    });

    it("returns 404 when the participant doesn't belong to this session", async () => {
      const sessionA = await createSessionWithParticipants(1);
      const sessionB = await createSessionWithParticipants(1);
      const participantFromB = sessionB.participants[0];

      const { status } = await api(
        `/api/sessions/${sessionA.id}/participants/${participantFromB.id}/qr`,
        { method: "DELETE" },
      );

      expect(status).toBe(404);
    });
  },
);
