Status: ready-for-agent
Severity: Medium
Category: Correctness

# Expense creation cap is advisory only — a concurrent burst lands a session arbitrarily far past it

Ticket 28 removed the *sequential* path past `MAX_EXPENSES_PER_SESSION` but deliberately left the check-then-act window open, on the reasoning that giving bulk reorder headroom (`MAX_REORDER_IDS = 500`) made an overshoot survivable. The 3-lens review of that fix showed the overshoot is not bounded at all, so the headroom does not survive an adversary or a large enough burst.

Location: app/api/sessions/[sessionId]/expenses/route.ts (POST), lib/expenseSession.ts (MAX_EXPENSES_PER_SESSION)

Reproduced (correctness lens, 2026-08-30): 700 concurrent POSTs against a fresh session, cap 50 → **700×201**. The session lands at 700 expenses and `PATCH /expenses` then returns 400 on every request forever, since 700 > 500. Recovery needs 200+ individual DELETEs to get back under the reorder bound.

Mechanism: `lib/db.ts` sets the pg pool to `max: 1`. Each handler awaits its own `loadExpenseSessionContext` read before issuing its `expense.create`, so with a single connection serving a FIFO queue **every read in a burst drains before the first write commits**. The landed count therefore equals the burst size exactly. Production is multi-instance with a pool each, so the local number is a lower bound.

Why this is filed rather than fixed inline: an adversarial burst is inside the documented "anyone with the session link can mutate it" trust model — that caller can already delete every expense. The realistic case (accidental double-submit) is handled by ticket 28's headroom. So this is a robustness gap, not a live exploit, and closing it reverses ticket 28's deliberate decision against locking.

Options if picked up:
- `pg_advisory_xact_lock(hashtext(session_id))` at the top of a transaction wrapping the count-read and the create. Serializes expense creation per session, which is acceptable for a friend-group-sized session.
- A DB-level enforcement (trigger, or a counter column with a CHECK constraint) — no application race at all, but adds schema surface.
- Accept permanently and instead make the reorder path tolerate any count, e.g. paginate or drop `MAX_REORDER_IDS` entirely, so overshoot is never fatal regardless of size.

Found by: 3-lens review of the tickets 27-34 slice (2026-08-30); all three lenses flagged it, correctness reproduced it at 700 concurrent.
