Status: fix-on-touch (was: needs-triage)
Severity: Low
Category: Performance

# `GET /api/sessions/:sessionId` embeds a full participant object under every payer and every split

The route's `include: { payer: true, splits: { include: { participant: true } } }` plus `serializeExpense`/`serializeExpenseSplit` means every expense's payer and every split's participant is serialized as a **full** participant object — including `payment_details` and the (long) Supabase `qr_code_url` — rather than a reference to the participant already present in the top-level `participants` array.

Location: app/api/sessions/[sessionId]/route.ts:18-29; lib/serialize.ts (serializeExpense, serializeExpenseSplit)

Cost: a 20-expense, 5-person session ships roughly 120 embedded participant copies (100 splits + 20 payers) of only 5 distinct people, on the app's hottest route — fetched by the session page, the settle page, and the view page. This is payload bloat, not N+1: Prisma issues a fixed ~6 queries for this shape (confirmed no `relationLoadStrategy` is configured), of which exactly 2 (the payer lookup, the split-participant lookup) re-fetch rows already returned by the top-level participants query.

Needs triage — two mutually exclusive fixes, pick one:

- **(a) Narrow the nested `select` to `{ id, name }`.** Kills the payload duplication (the real cost). Changes the API response shape: `tests/sessions.integration.test.ts:93,448` assert exact key sets on the nested participant object ("does not leak internal database columns") and would need updating to match the narrower shape. Needs a narrower serializer than the current `serializeParticipant`.
- **(b) Drop the includes and join from `session.participants` in JS instead.** Response stays byte-identical, no test changes — but only removes the 2 redundant queries, not the payload duplication. Converts an impossible-today case (a split whose participant isn't in the session) from "works" into a crash on `serializeParticipant(undefined)`; `buildExpenseSplits` already enforces membership and no route deletes a Participant, so this is safe today but the fix should add an explicit guard rather than rely on that invariant silently.

Recommendation from the reviewing agent: (a) — the payload is the durable cost and the test churn is mechanical. Confirm before implementing since it changes the wire contract.

Found by: best-practice-reviewer, holistic review (2026-08-28).
