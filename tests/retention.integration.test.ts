// Schema-level tests for the data-retention delete path.
//
// Deliberately NOT in sessions.integration.test.ts: that suite talks to a running server over
// real HTTP and never imports app internals (see its header). This one asserts a property of the
// database itself — that `DELETE FROM "Session"` cascades — which no HTTP route exercises, since
// the app has no delete-session endpoint. The only caller is the pg_cron job in Supabase
// (CLAUDE.md "Data retention"), so the statement it runs is what gets tested here.
//
// This file exists because ticket 26 shipped undetected: the cascade was reasoned about in schema
// comments and reviewed, but no test ever deleted a Session, so nobody ran the statement.
//
// Requires: Postgres up (podman-compose up -d). Run with: npm run test:integration

import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../lib/db";

// Every session this file creates is named with this prefix, so cleanup can find them all even
// if an assertion fails partway through and leaves rows behind.
const PREFIX = "retention-test-";

// Build a session shaped like a real one: two participants, an expense with splits for both, and
// a frozen settlement plan. Each of those is a different FK path into Participant, which is what
// the cascade has to get through.
async function createFullSession(label: string) {
  const session = await prisma.session.create({
    data: { name: `${PREFIX}${label}`, participants: { create: [{ name: "P1" }, { name: "P2" }] } },
    include: { participants: true },
  });
  const [p1, p2] = session.participants;
  // Narrows for the type checker and fails loudly if the fixture ever stops creating both —
  // a silently half-built fixture would make the cascade assertions below prove nothing.
  if (!p1 || !p2) throw new Error("fixture: expected two participants");

  await prisma.expense.create({
    data: {
      session_id: session.id,
      paid_by: p1.id,
      amount: 100,
      description: "dinner",
      split_type: "EVEN",
      splits: { create: [{ participant_id: p1.id, amount_owed: 50 }, { participant_id: p2.id, amount_owed: 50 }] },
    },
  });

  await prisma.settlement.create({ data: { session_id: session.id, from_id: p2.id, to_id: p1.id, amount: 50 } });

  return { session, p1, p2 };
}

afterEach(async () => {
  // Raw delete rather than the Prisma helper: if the cascade regresses, the whole point is that
  // this statement is the one that fails, and we'd rather see that than mask it with a
  // hand-ordered teardown that works either way.
  await prisma.$executeRawUnsafe(`delete from "Session" where name like $1`, `${PREFIX}%`);
});

describe("data retention — DELETE FROM \"Session\" cascades", () => {
  it("deletes a session that has participants, expenses, splits, and a frozen plan", async () => {
    const { session } = await createFullSession("full");

    // The literal statement the pg_cron job runs, not prisma.session.delete() — the job issues
    // raw SQL, and a Prisma-only test would not prove the constraint is satisfied in the database.
    const deleted = await prisma.$executeRawUnsafe(`delete from "Session" where id = $1`, session.id);

    expect(deleted).toBe(1);
  });

  it("leaves no orphaned child rows behind", async () => {
    const { session, p1, p2 } = await createFullSession("orphans");
    const expenseIds = (await prisma.expense.findMany({ where: { session_id: session.id }, select: { id: true } })).map((e) => e.id);

    await prisma.$executeRawUnsafe(`delete from "Session" where id = $1`, session.id);

    expect(await prisma.participant.count({ where: { id: { in: [p1.id, p2.id] } } })).toBe(0);
    expect(await prisma.expense.count({ where: { id: { in: expenseIds } } })).toBe(0);
    expect(await prisma.expenseSplit.count({ where: { expense_id: { in: expenseIds } } })).toBe(0);
    expect(await prisma.settlement.count({ where: { session_id: session.id } })).toBe(0);
  });

  it("deletes a mixed batch in one statement, the way the monthly job does", async () => {
    // The job deletes by age, not by id, so populated and empty sessions go in the same statement.
    // A single blocked row rolls the whole thing back — which is exactly how ticket 26 stopped
    // even the empty sessions from being cleaned up.
    await createFullSession("batch-populated");
    await prisma.session.create({ data: { name: `${PREFIX}batch-empty`, participants: { create: [{ name: "solo" }] } } });

    const deleted = await prisma.$executeRawUnsafe(`delete from "Session" where name like $1`, `${PREFIX}batch-%`);

    expect(deleted).toBe(2);
  });

  it("still refuses to delete a participant who is referenced elsewhere", async () => {
    // The cascade added for ticket 26 is scoped to ExpenseSplit on purpose. Deleting a Participant
    // directly must still fail loudly rather than silently voiding one side of a payment plan —
    // the reasoning recorded on Settlement.debtor/creditor in schema.prisma. If this test ever
    // starts passing a delete through, that decision has been eroded by accident.
    const { p1 } = await createFullSession("participant-guard");

    await expect(prisma.participant.delete({ where: { id: p1.id } })).rejects.toThrow();
  });
});
