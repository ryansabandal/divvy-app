Status: resolved
Severity: Low
Category: Best-Practice

# Reorder's "must include every expense" error string is hand-copied in two places

Location: app/api/sessions/[sessionId]/expenses/route.ts (PATCH)

Ticket 04's fix added a `catch` block around the reorder transaction that returns 400 with the
literal string `"expense_ids must include every expense in this session exactly once"` — the same
string the route's pre-existing `isCompleteReorder` validation already returns. The catch block's own
comment states the intent explicitly: reusing the message means both paths tell the client the same
true thing. That intent is enforced only by having copy-pasted the string correctly once; nothing
stops the two from drifting apart on a future edit.

Fix: hoist the string to a module-level `const INCOMPLETE_REORDER_MESSAGE` and reference it from both
sites.

Related, same shape, pre-existing (not introduced by this diff — fold into the same fix rather than
filing separately): `"expense not found in this session"` appears three times across
app/api/sessions/[sessionId]/expenses/[expenseId]/route.ts.

Found by: best-practice-reviewer, 3-lens Tier 1 review (2026-08-29).

**2026-08-30 — fixed.** Three module-level consts, eight call sites:

- `INCOMPLETE_REORDER_MESSAGE` — `expenses/route.ts`, 2 sites.
- `EXPENSE_NOT_FOUND_MESSAGE` — `expenses/[expenseId]/route.ts`, **4** sites.
- `SETTLEMENT_NOT_FOUND_MESSAGE` — `settlements/[settlementId]/route.ts`, 2 sites.

**Correction to this ticket:** it enumerated `"expense not found in this session"` as 3× (lines 37, 72, 104) and missed the DELETE lookup miss at line 94. It is 4×. The discrepancy surfaced because the edit asserted an exact occurrence count instead of a blind replace, which would have patched three and silently left one behind.

The settlement pair only existed because ticket 27 landed first and created the second copy — the deliberate 27-before-31 ordering is what kept this slice from leaving a fresh duplicate behind.
