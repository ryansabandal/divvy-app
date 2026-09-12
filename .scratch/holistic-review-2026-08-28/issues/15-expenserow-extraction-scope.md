Status: resolved
Severity: Low
Category: Best-Practice

# `ExpenseRow` extraction — CHANGELOG's top priority, confirmed and scope is bigger than filed

CHANGELOG.md already flags `app/[sessionId]/page.tsx`'s `SortableExpenseCard` and `app/[sessionId]/view/page.tsx`'s inline expense row as near-identical JSX that had to be edited in lockstep, with an `ExpenseRow` extraction planned (a shared inner component wrapped differently by each page's `<li>`, since `SortableExpenseCard` carries drag-and-drop wiring the read-only row doesn't).

This review confirms it and finds the extraction should absorb more than currently scoped, in the same pass:

- **The split-type label cascade** is character-for-character identical between the two pages (`EVEN` → "split evenly", `QUANTITY` → "N units · ₱X each", else "custom split"). Location: page.tsx:100-104, view/page.tsx:85-89. This is a repeated switch on `split_type` that will drift the moment a fourth split type or a wording change lands.
- **The per-split list** (including the `×{units}` suffix) is identical between the two pages. Location: page.tsx:107-117, view/page.tsx:92-102.
- `participantsById` and `derivedSessionPayer` are computed identically in both pages' outer scope (settle:47,50 / view:42,46) — minor, but worth folding into the same pass since they feed the extracted component.

Failure scenario already happened once: these blocks were edited in lockstep when the session-payer picker landed (`SessionPayerNote` was extracted one level up specifically because of this same lockstep hazard, per its own header comment — but `settle/page.tsx` was the one location that got missed in that pass).

Fix sketch: extract the label cascade and per-split list into the shared `ExpenseRow` inner component alongside the description/amount/drag-handle work already planned, rather than doing a second pass later.

Found by: best-practice-reviewer, holistic review (2026-08-28) — confirming and expanding CHANGELOG.md's existing top-priority item.

## Comments

**2026-09-05 — restored from `fix-on-touch`**, alongside h18/h14/qr-12/qr-13; see h18's comment
for the full reasoning (blanket demotion over-applied to cluster E's large, sign-off-required scope).

**2026-09-05 — this ticket's own framing is stale.** Re-reading the current file: `SortableExpenseCard`
is *already* extracted (`page.tsx:36-121`), so "extract an `ExpenseRow`" as a from-scratch task no
longer describes the remaining work. The actual gap is narrower and still real: `view/page.tsx:78-103`
hand-rolls its own row inline, duplicating the split-type label cascade (`page.tsx:101-105` vs
`view/page.tsx:85-89`) and the per-split list (`:108-118` vs `:92-102`) verbatim. The fix is a shared
`components/ExpenseRow.tsx` rendering row *contents* only (each page keeps its own `<li>`, since
`SortableExpenseCard` carries `useSortable` wiring the read-only row doesn't) — `SortableExpenseCard`
wraps it rather than being replaced by it. Full component contract in
`.scratch/plans/session-page-decomposition.md`, Slice 1.

**2026-09-12 — resolved, discovered stale during an unrelated ticket's doc pass.** `components/ExpenseRow.tsx`
shipped in commit `75e2f9a` ("Extract shared ExpenseRow and clipboard-copy hook"). Confirmed both
`app/[sessionId]/page.tsx` and `app/[sessionId]/view/page.tsx` import and render it (`grep -n "ExpenseRow"`
against both files) — the duplication this ticket flagged no longer exists. This ticket was pulled out of
cluster E individually, same as qr-13 was for a different reason; see `.scratch/BACKLOG.md` cluster E.
