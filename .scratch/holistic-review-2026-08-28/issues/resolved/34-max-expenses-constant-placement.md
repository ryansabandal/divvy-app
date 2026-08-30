Status: resolved
Severity: Low
Category: Best-Practice

# MAX_EXPENSES_PER_SESSION lives in schemas/sessions.ts, a module CLAUDE.md defines as schemas-only

Location: schemas/sessions.ts (MAX_EXPENSES_PER_SESSION)

CLAUDE.md's Project Structure documents schemas/sessions.ts as "Zod schemas for every request
body." Ticket 03 added `MAX_EXPENSES_PER_SESSION` there as a plain exported constant, then imported
it into app/api/sessions/[sessionId]/expenses/route.ts for a non-validation purpose (a business-rule
count check, not shape validation). The repo's existing precedent for a cross-cutting domain constant
is the lib module that owns the concept — e.g. `RECONCILED_EPSILON` lives in lib/settle.ts and is
imported by lib/expenseSplits.ts and (as of ticket 06) a client component.

Counterweight, why this is filed as a judgment call rather than a clear-cut fix: the constant is also
consumed by the Zod schema in that same file (reorderExpensesSchema's `.max()`), so co-location is
defensible, and the file already carries several unnamed numeric caps of the same shape (e.g.
participant/name length limits).

Options if this is picked up: move it to lib/expenseSession.ts (already owns the concept and produces
the count), or — if more cross-cutting limits are expected to accumulate — a new lib/limits.ts.

Found by: best-practice-reviewer, 3-lens Tier 1 review (2026-08-29).

**2026-08-30 — fixed**, and ticket 28 dissolved the judgment call this ticket was filed on. Splitting the cap left two constants of genuinely different kinds, each with an obvious home:

- `MAX_EXPENSES_PER_SESSION = 50` → **`lib/expenseSession.ts`**, which already owns the concept and produces the count that enforces it. Mirrors `RECONCILED_EPSILON` living in `lib/settle.ts`.
- `MAX_REORDER_IDS = 500` → **stays in `schemas/sessions.ts`**, consumed only by the Zod `.max()` beside it. Genuinely schema config, so the counterweight this ticket raised applies to it and not to the business rule.

`schemas/sessions.ts` is Zod-schemas-only again, matching CLAUDE.md's description of it. A new `lib/limits.ts` was considered and rejected: a new lib module would widen the CLAUDE.md Project-Structure drift ticket 33 is about.
