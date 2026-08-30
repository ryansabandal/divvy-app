Status: resolved
Severity: Medium
Category: Correctness

# Drag-and-drop reorder breaks permanently past 50 expenses

`reorderExpensesSchema` caps `expense_ids` at 50, and the reorder route requires the *complete* ordered list of every expense in the session (partial lists are rejected). But nothing caps expense creation — `POST /expenses` has no count check.

Location: schemas/sessions.ts:47 (cap); app/api/sessions/[sessionId]/expenses/route.ts (POST has no cap)

Failure scenario: a session accumulates 51 expenses. Every subsequent drag 400s on "expense_ids must be 50 or fewer" before the completeness check is even reached. `handleDragEnd` shows "Failed to save the new order" and snaps the card back. There is no user-reachable way out except deleting expenses down to 50.

The asymmetry is the tell: participants are capped at 50 **at creation** (`createSessionSchema`), so the cap and the data can never disagree there. Expenses are capped only on the read-back side.

Fix: cap expense creation at 50 in the `POST /expenses` route, mirroring the participant pattern. Requires adding `_count: { select: { expenses: true } }` to the `findUnique` in `loadSessionParticipants` (lib/expenseSession.ts) — that function currently only fetches participants. **Write the invariant down as a comment: reorder cap ≥ creation cap**, so the two can't drift apart again.

Note: this closes the asymmetry going forward only; a session already over 50 expenses stays permanently un-reorderable. The one-month retention window (CLAUDE.md "Data retention") makes an existing over-50 session unlikely but not verified absent — check before assuming none exist.

Also note: this ticket's fix touches the same `loadSessionParticipants` query as ticket 10 (loadSessionParticipants-overfetch, which wants to narrow the same call to `select: { id: true }`) — whichever fix lands second must not drop the other's requirement (the id set AND the count both need to survive).

No test currently exercises the reorder route at or over the 50-id cap — add one.

Found by: correctness-reviewer, holistic review (2026-08-28).

## Comments

**2026-08-29 — fixed.** `MAX_EXPENSES_PER_SESSION = 50` is now exported from `schemas/sessions.ts` and used by *both* the reorder schema's `.max()` and a new count check in `POST /expenses`, so the invariant the ticket asked to be written down (**reorder cap ≥ creation cap**) is enforced by the two sides sharing one constant rather than by a comment nobody re-reads. The comment explains why it must hold: if creation could outrun the reorder cap, every drag in that session would 400 forever with no user-reachable way out.

`loadSessionParticipants` gained `expenseCount` via `_count: { select: { expenses: true } }` on its existing `findUnique` — no extra round trip.

**The cap is enforced in `POST` only, deliberately never in the helper.** `loadSessionParticipants` is shared with the expense-edit `PATCH`; capping inside it would make an already-over-50 session uneditable — the exact trap this ticket describes, just moved one layer down.

**Collision note for Tier 2 is now live code, not a warning:** ticket 09/10's narrowing of this same `findUnique` must not drop the `_count`. A comment at the query says so.

Still outstanding from this ticket: the live production check for any existing session already over 50 expenses (the cap strands such a session permanently), and the at-cap reorder test in step 9.
