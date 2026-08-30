Status: resolved
Severity: Medium
Category: Correctness

# Expense creation cap (ticket 03) is check-then-act — concurrent creates still overshoot it

Ticket 03 added a cap check in `POST /expenses` reading `expenseCount` from `loadSessionParticipants`,
then creating the expense in a separate statement. Nothing in the database enforces the ceiling, so
the fix removes the *sequential* dead end but not the *concurrent* one.

Location: app/api/sessions/[sessionId]/expenses/route.ts (POST)

Failure scenario, reproduced twice independently (once by the security-lens reviewer at 80 concurrent
requests, once by the orchestrating session at 70): N simultaneous `POST /expenses` calls against a
session below the cap. Every request's `loadSessionParticipants` call returns the same pre-write
count, every request passes `expenseCount >= MAX_EXPENSES_PER_SESSION` as false, and all N create.
70 concurrent POSTs against an empty session landed 70×201, leaving the session with 70 expenses
under a cap of 50 — and that session's `PATCH /expenses` (bulk reorder) then 400s on every request
forever, which is the exact dead end ticket 03 exists to remove, just reached through a different
door.

Recommended fix — not a transaction or row lock: the invariant ticket 03 established is
*reorder cap >= creation cap*. Setting them **equal** is what makes any overshoot fatal. Give reorder
headroom instead — keep creation capped at `MAX_EXPENSES_PER_SESSION = 50`, but raise
`reorderExpensesSchema`'s `.max()` to a larger payload-only bound (e.g. 500) so a session that
overshoots via a race can still be reordered. This makes atomicity a nice-to-have rather than
load-bearing, and is a one-line schema change instead of a `$transaction`/advisory-lock rework.

Found by: 3-lens Tier 1 review (2026-08-29) — all three lenses independently flagged this; the
correctness lens noted it as structurally certain but did not execute a repro, the security lens
executed one (80 concurrent), the orchestrating session executed a second (70 concurrent).

**2026-08-30 — fixed** via the ticket's recommended route, not a transaction or advisory lock. The two caps are no longer one constant:

- `MAX_EXPENSES_PER_SESSION = 50` — the business rule, enforced per-request by `POST /expenses`.
- `MAX_REORDER_IDS = 500` — a payload bound only, consumed by `reorderExpensesSchema`'s `.max()`.

Concurrent creates can still overshoot 50, but reorder now accepts an order of magnitude more ids, so an overshot session stays reorderable and the dead end is gone. The cap is deliberately soft; making it hard needs a DB constraint or advisory lock, which this ticket argued against.

Both comments that asserted the old equality were rewritten — `schemas/sessions.ts` ("One constant keeps the two in step") and the cap check in `expenses/route.ts` ("Capped at the same number bulk reorder accepts") were false the moment the caps diverged.

Constant placement is ticket 34, resolved by the same change.

**Correction (2026-08-30, 3-lens review of this fix) — the note above overstates what shipped.** "An overshot session stays reorderable and the dead end is gone" is false. **Reproduced by the correctness lens: 700 concurrent POSTs → 700×201, session lands at 700, reorder then 400s permanently** — the same dead end, through the door this fix believed it closed.

Mechanism, which the fix's reasoning missed: `lib/db.ts` sets the pool to `max: 1`, so every request's read drains before the first write is issued and **the landed count equals the burst size exactly** — not "slightly over". No constant can dominate burst size, so `MAX_REORDER_IDS` is a higher wall, not a ceiling.

**Kept anyway, deliberately.** It still fixes the realistic case (an accidental double-submit lands a handful over 50 and stays reorderable), and it remains a strict improvement on the pre-fix state, which had no creation cap at all — the sequential path is fully closed and only a one-shot concurrent burst remains. An adversarial burst sits inside the documented "anyone with the session link can mutate it" trust model: that caller can already delete every expense in the session.

The code comment claiming "slightly over" was rewritten to state the real limitation. A hard cap is ticket 36.

**Also corrected: ticket 13 is NOT amplified by this change.** Both the orchestrating session and the security lens assumed raising the payload bound to 500 raised that route's worst-case transaction size 10×. It does not — `isCompleteReorder` requires `expense_ids.length === session.expenses.length`, so the transaction always has exactly as many statements as the session has expenses, and a 500-id payload against a 3-expense session 400s before any transaction opens. Ticket 13's "bound: 50 sequential updates" premise is stale in wording only; the real bound is the session's expense count.
