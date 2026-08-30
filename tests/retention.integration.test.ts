// Schema-level tests for the data-retention delete path.
//
// Deliberately NOT in sessions.integration.test.ts: that suite talks to a running server over
// real HTTP and never imports app internals. This one asserts a property of the database itself —
// that `DELETE FROM "Session"` cascades — which no HTTP route exercises, since the app has no
// delete-session endpoint. Its only caller is the pg_cron job in Supabase (CLAUDE.md "Data
// retention"), so the statement that job runs is what gets tested here.
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

    // The literal statement the pg_cron job runs — a prisma.session.delete() would not prove the
    // constraint is satisfied in the database
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
    // The job deletes by age, not by id, so populated and empty sessions go in one statement and
    // a single blocked row would roll back the whole batch
    await createFullSession("batch-populated");
    await prisma.session.create({ data: { name: `${PREFIX}batch-empty`, participants: { create: [{ name: "solo" }] } } });

    const deleted = await prisma.$executeRawUnsafe(`delete from "Session" where name like $1`, `${PREFIX}batch-%`);

    expect(deleted).toBe(2);
  });

  it("still refuses to delete a participant referenced by a settlement", async () => {
    // The cascade is scoped to ExpenseSplit on purpose: deleting a Participant directly must
    // still fail loudly rather than silently voiding one side of a payment plan.
    // p2 is the settlement's debtor and not the expense payer, so Settlement_from_id_fkey is the
    // constraint that fires — naming it keeps a different FK from satisfying this test by accident.
    const { p2 } = await createFullSession("participant-guard");

    await expect(prisma.participant.delete({ where: { id: p2.id } })).rejects.toThrow(
      /Settlement_from_id_fkey/,
    );
  });
});
