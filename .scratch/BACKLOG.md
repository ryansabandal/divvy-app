# Backlog index

**28 open tickets** (12 actively scheduled or needs-triage/needs-info, 16 demoted to `fix-on-touch`
— see the index near the bottom of this file) across three review directories, grouped by the code
they touch rather than by
the review that filed them. The directories stay as they are — they record provenance, and ~200
cross-references depend on the current numbering. This file is the grouping; it is a *view*, not a
move.

**2026-09-13:** h18, h14, and qr-12 (cluster E) closed — count updated from 31/15 to 28/12. See
cluster E below and each ticket's own resolution comment.

Ticket ids below are prefixed by origin, because the numbers collide across directories (there are
three `05`s, three `07`s, two `13`s):

| Prefix | Directory |
|---|---|
| `h` | `holistic-review-2026-08-28/issues/` |
| `v1` | `v1-hardening-audit/issues/` |
| `qr` | `v2-qr-ph-upload/issues/` |

Resolved tickets live in each directory's own `issues/resolved/` and are not listed here (47 of them).

Sequencing, verification commands, and the current resume state live in
`plans/tier1-review-fixes-27-37.md` (gitignored). This file is the *what*; that one is the *when*.

---

## Close first — already fixed in code

**[h06](holistic-review-2026-08-28/issues/06-client-server-custom-split-tolerance-mismatch.md)** ·
Medium · client/server CUSTOM-split tolerance mismatch.
The fix shipped: `app/[sessionId]/page.tsx:29` imports `RECONCILED_EPSILON`, and `:536`/`:991` use
it. Only the ticket file needs moving to `resolved/`.

**Do not close it silently** — h06 defers "constraining the custom-amount inputs to cent precision"
to a follow-up that was never filed. File that or explicitly drop it in the same move.

---

## A · Money precision and rounding

**~~h07~~** · ✅ **resolved 2026-08-30** · negative `amount_owed` from the remainder push
**~~h17~~** · ✅ **resolved 2026-09-05** · epsilon and rounding sprawl
**~~v1-05~~** · ✅ **resolved 2026-09-05** · no money util

h07 shipped `lib/money.ts` `distributeCents()`, called by both the EVEN and QUANTITY branches of
`buildExpenseSplits()`. That closes v1-05's "factor remainder-distribution into one function" and
h17's part (a), and removes every `Math.round(x * 100) / 100` from `lib/expenseSplits.ts`. h23
item 1 (exact `toBe` on the remainder assertions) went with it, as planned.

**The remaining pure-refactor commit landed 2026-09-05.** `roundToCents()` now lives next to
`distributeCents()` in `lib/money.ts`; `lib/expenseBreakdown.ts`'s misnamed `toCents()` is gone in
favor of it; `components/ExpenseBreakdown.tsx`'s re-declared `CENT_EPSILON` is gone in favor of
importing `RECONCILED_EPSILON` from `lib/settle.ts` directly; `lib/settle.ts:50`'s own
`Math.round(x*100)/100` (a sibling site not named in either ticket) now calls `roundToCents()` too.
The bare `0.01` literals in `lib/settlementHelpers.ts` and `app/[sessionId]/page.tsx` had already
been closed by h06/ticket 01's earlier fixes — no action needed there. This closes cluster A
entirely; both tickets' full resolution notes are in their respective `issues/resolved/`.

**Carry forward:** `distributeCents()` guarantees an exact sum *in centavos*. Peso sums are still
floats — the 18-way ₱1.00 split adds up to `1.0000000000000004` — so check the specific addition
before pinning any total with an exact assertion.

## B · Settlements route: queries and ordering

**~~h08~~** · ✅ **resolved 2026-09-05** · frozen settlements returned with no `orderBy`
**~~h09~~** · ✅ **resolved 2026-09-05** · route re-fetches names it already holds

Both rewrote the same two calls: `settlements/route.ts` GET and POST.

**Decision made:** added `sort_order Int @default(autoincrement())` to `Settlement`
(migration `20260905015358_settlement_sort_order`), matching the existing
`Participant.sort_order`/`Expense.sort_order` pattern — chosen over the simpler
`orderBy: { id: "asc" }` so the settle screen keeps the greedy plan's
largest-debts-first order rather than an arbitrary UUID sort. **Confirmed applied
to production 2026-09-05** (Supabase table editor shows `Settlement.sort_order
int4`) — this file's earlier "applied locally only" was stale; corrected here.

GET now orders both `findMany` calls by `sort_order`; POST uses
`createManyAndReturn` (no more third re-read query) and explicitly re-sorts its
result by `sort_order` rather than trusting `RETURNING` row order. Names in
both come from a `participantsById` map off `session.participants` (already
loaded), not a `debtor`/`creditor` relation include. Verified by execution:
built a 2-settlement-row plan, marked one paid, confirmed GET's row order was
identical before and after the `UPDATE` — the exact scenario h08 was filed for.
`npm run test:integration` — 99/99. Full notes on each ticket's `resolved/` file.

## C · Expenses route: cap and reorder under load

**[h36](holistic-review-2026-08-28/issues/36-expense-cap-not-enforced-under-concurrency.md)** · Medium · cap is advisory only (reproduced at 700 concurrent)
**[h13](holistic-review-2026-08-28/issues/13-reorder-one-update-per-expense.md)** · Low · one UPDATE per expense in the reorder transaction

They interact: h36's third option is "drop `MAX_REORDER_IDS` so overshoot is never fatal," which
changes what h13 is optimizing. Decide h36's direction before touching h13's transaction.

Both `needs-triage`-grade decisions. h36 reverses ticket 28's deliberate choice against locking.

## D · Route hardening — small, independent, shippable now

**~~h38~~** · ✅ **resolved 2026-09-05** — unbounded `amount` overflows to `Infinity`, piloted the
new review-workflow rules (see `issues/resolved/38-...md`). Also fixed the sibling `amount_owed`
field the ticket itself missed, per the new "enumerate the class" rule.


**[h10](holistic-review-2026-08-28/issues/10-loadsessionparticipants-overfetch.md)** · Low · narrow the `include` to `select: { id: true }`
**[h37](holistic-review-2026-08-28/issues/37-participant-qr-routes-unguarded-p2025.md)** · Low · apply `isMissingRowError()` to 3 more routes
**[h21](holistic-review-2026-08-28/issues/21-fetcher-error-messages-swapped.md)** · Low · two mislabeled fetcher strings

No dependencies on anything else. h10 **must keep `_count: { select: { expenses: true } }`** or the
expense cap breaks — `tsc` catches it, but the fix is to keep `_count`, never to delete the
destructure to quiet the compiler. h37 is a mechanical copy of the settlement PATCH shape.

## E · Frontend: session-page decomposition — ✅ RESOLVED 2026-09-13

**~~h18~~** · ✅ **resolved 2026-09-13** · ~900-line component, four concerns
**~~h14~~** · ✅ **resolved 2026-09-13** · full list re-render per keystroke
**~~qr-12~~** · ✅ **resolved 2026-09-13** · label mapping across three call sites (moved to `v2-qr-ph-upload/issues/resolved/`)

h18 and h14 state outright they must be done together — the same extraction fixes both the file size
and the re-render coupling.

**h15 (`ExpenseRow` extraction) and qr-13 (QR file-input JSX) both resolved and pulled out of this
cluster individually, on the pattern each ticket predicted before h18's decomposition ever starts:**
h15 shipped as `components/ExpenseRow.tsx` in `75e2f9a`, found stale 2026-09-12 during an unrelated
doc pass. qr-13 shipped as `components/QrFileInput.tsx` in `4de6022`, pulled forward the same session
because qr-03's `capture`/`accept` fix would otherwise have needed applying in two places. Neither
closes h18 itself — both new components are things a future `PaymentMethodEditor`/session-page
decomposition would *import*, not reshape, so this isn't scope creep into the blocked cluster.

**qr-12 still belongs here**, which the ticket itself doesn't say: it lives inside the
`PaymentMethodEditor` that h18 extracts. Working it separately means touching that JSX twice.

Largest change in the backlog. Needs a decomposition plan (what components, what props, what stays
in the parent) and sign-off before any edit.

**2026-09-05 — restored to scheduled status.** All five tickets here were briefly swept into the
2026-09-05 blanket demotion of open Low tickets, which was written to target sub-five-minute
opportunistic fixes (CONTRIBUTING.md's "Review findings: what earns a ticket"), not a ~900-line,
sign-off-required decomposition. User confirmed: restore, don't leave this cluster to be "fixed in
passing."

**2026-09-05 — decomposition plan written:** `.scratch/plans/session-page-decomposition.md`.
Three sequenced slices (shared row + clipboard hook; payment-method editor + QR; expense list +
form), each its own review boundary. Also folds in h19 (clipboard triplication, cluster F) as part
of slice 1. Execution is still separate future work — the plan alone is what shipped this session.
Discovery corrected two of the five tickets' own framing: h15 is not "extract an `ExpenseRow`" —
`SortableExpenseCard` already exists; the live work is `view/page.tsx`'s duplicate row. h14 closes
by construction once `ExpenseForm` is extracted, with no `React.memo`/`useCallback` needed. See
the plan file and each ticket's own comment for detail.

**2026-09-13 — all three slices shipped, cluster fully closed.** Slice 1 (`75e2f9a`), Slice 2 and
Slice 3 (staged, same session) each 3-lens reviewed and fixed. `page.tsx` went from 1046 lines to
~255. Full detail: CHANGELOG.md's dated "Cluster E Slice 2"/"Cluster E Slice 3" entries, the plan
file's own Slice 2/3 sections, and each ticket's resolution comment.

## F · Frontend: shared extraction outside the big decomposition

**[h16](holistic-review-2026-08-28/issues/16-settlementrow-extraction.md)** · Low · `SettlementRow` duplicated between settle and view
**[v1-07](v1-hardening-audit/issues/07-dedupe-finalize-recalculate.md)** · Low · `handleFinalize`/`handleRecalculate` near-identical
**[h19](holistic-review-2026-08-28/issues/19-copy-to-clipboard-triplicated.md)** · Low · copy-to-clipboard implemented three times, drifted timeout

**These do not depend on cluster E**, despite h16's own "plan together" note. h16 and v1-07 both
touch `settle/page.tsx` and `view/page.tsx` only; h19 is a hook that survives any later
restructuring. All three are shippable today.

## G · Frontend: data fetching and payload

**[h11](holistic-review-2026-08-28/issues/11-session-get-participant-payload-duplication.md)** · Low · full participant embedded under every payer and split — **`fix-on-touch`**
**[h12](holistic-review-2026-08-28/issues/12-mutations-discard-response-refetch-graph.md)** · Low · every mutation refetches the whole session graph — **`fix-on-touch`**

h12 explicitly builds on h11's characterization of the session GET, and h12's fix reduces how often
h11's bloated payload is fetched. **Both demoted to `fix-on-touch` 2026-09-05** (see the index near
the bottom of this file) — not a scheduled decision anymore. h11's own text still records the two
mutually-exclusive options for whoever next touches `app/api/sessions/[sessionId]/route.ts`: the
reviewing agent recommended (a), narrowing the nested `select`, since the wire-contract change it
requires is mechanical test churn, not a real tradeoff.

## H · QR display robustness

**[qr-07](v2-qr-ph-upload/issues/07-dangling-qr-image-no-fallback.md)** · Low · dangling QR renders as a broken image

Touches the QR `<img>` surface in `PaymentAction.tsx`.

**qr-03 resolved 2026-09-12** (moved to `issues/resolved/`) — real device confirmed the fix: dropped
`capture="environment"`, widened `accept` to `image/*`, extracted into `components/QrFileInput.tsx`
alongside qr-13 (see cluster E below).

## I · Test suite

**[h23](holistic-review-2026-08-28/issues/23-test-suite-precision-and-gaps.md)** · Medium · imprecise assertions and missing negative cases
**[qr-06](v2-qr-ph-upload/issues/06-storage-configured-test-gate-wrong-process-env.md)** · Low · `STORAGE_CONFIGURED` reads the wrong process's env

**h23 is deliberately split across other clusters** — its own instruction is to fix each item
alongside the corresponding code fix.

- **Item 1 → done 2026-08-30** with h07 (cluster A).
- **Items 4, 5, 6 → doable now.** Item 4's pairings (tickets 01, 03, 04, 05) are all resolved, so
  those negative cases are writable today; the exception is the reorder-at-cap case, which pairs
  with still-open h36. Items 5 and 6 always stood alone. Item 5 is the one that matters — a failing
  assertion above the trailing QR `DELETE` leaks a real object into a production-adjacent bucket,
  permanently, and h24 says nothing reclaims it.
- **Item 3 → resolved 2026-09-05**, moot now that h08 shipped (cluster B) — order is genuinely
  guaranteed, no test edit needed. **Item 2 still open** — a real behavior question (should `POST`
  report `frozen: true` when the computed plan is empty?), deliberately not folded into the
  ordering/query fix. Still `fix-on-touch`.

qr-06 is independent test-infra work.

## J · Papercuts — one batch

**[h22](holistic-review-2026-08-28/issues/22-nativeenum-deprecated-and-type-boundary.md)** · Low · three small hygiene items
**[v1-09](v1-hardening-audit/issues/09-submitevent-vs-formevent.md)** · Low · `React.SubmitEvent` → `React.FormEvent`
**[v1-10](v1-hardening-audit/issues/10-stale-even-custom-comment.md)** · Low · comment omits QUANTITY
**[v1-22](v1-hardening-audit/issues/22-recentsessions-setstate-in-effect.md)** · Low · `setState` in an effect on the home page

Unrelated one-liners, cheap together. h22 item 3 closes the single `exhaustive-deps` warning in the
lint baseline. **h22 item 2 is explicitly a comment, not a code change** — do not deduplicate
`lib/types.ts`'s hand-written unions; the split keeps `@prisma/client` out of the client bundle.

Worth folding in here: **five ticket-number references in source comments** violate the repo's own
comment rule (no ticket numbers in code) — `qr/route.ts:100`, `SettlementProgress.tsx:23`, and three
in `tests/sessions.integration.test.ts`. They are also ambiguous, since the numbers collide across
directories.

## L · Not code — external config or a production check

**[h35](holistic-review-2026-08-28/issues/35-qr-path-guards-not-retroactive.md)** · `needs-info` · production query, **port 5432 not 6543**
**[h25](holistic-review-2026-08-28/issues/25-bucket-content-type-size-unverified.md)** · `needs-triage` · Supabase bucket MIME/size settings
**[h24](holistic-review-2026-08-28/issues/24-orphaned-qr-storage-objects.md)** · Medium · Storage lifecycle for orphaned QR objects
**[qr-08](v2-qr-ph-upload/issues/08-unbounded-signed-url-minting-quota-exhaustion.md)** · `needs-triage` · signed-URL quota exhaustion
**[qr-09](v2-qr-ph-upload/issues/09-session-id-embedded-in-public-qr-url.md)** · `needs-triage` · session id embedded in the public QR URL
**[qr-11](v2-qr-ph-upload/issues/11-swapped-qr-harder-to-detect-than-swapped-number.md)** · informational · swapped QR harder to notice

None are agent-actionable from the repo. h35, h25, and h24 all need a dashboard or production check;
qr-09 and qr-11 are trust-model judgments about the "anyone with the link" posture.

**h35 carries a trap:** do not preemptively add `encodeURIComponent` to `publicObjectUrl` — it
encodes the `/` separators and breaks every valid path. Remediation follows the query result.

---

## Suggested order

1. ~~**A** — h07 with its helper in `lib/money.ts`, plus h23 item 1.~~ ✅ done 2026-08-30.
2. ~~**D** — h38.~~ ✅ done 2026-09-05, piloting the new review-workflow rules.
3. ~~**A** — the h17 remainder, as its own refactor commit.~~ ✅ done 2026-09-05.
4. ~~**B** — h08 + h09 + h23 item 3.~~ ✅ done 2026-09-05 (h23 item 2 stays open, `fix-on-touch`).
5. ~~**D** — h10, h37, h21.~~ demoted to `fix-on-touch` 2026-09-05 (see the index below) — no longer
   a scheduled step. **F** (h16, v1-07, h19) and **G** (h11, h12) are similarly demoted.
6. ~~**E** — the decomposition plan and its three slices.~~ ✅ done 2026-09-13 (see cluster E).
7. **C** — h36 direction, and by extension h13's transaction. ← **next**
8. ~~**K** — h20.~~ ✅ done 2026-11-13, ahead of C. The pointer-instead-of-copy fix means later clusters no longer have a schema copy to re-sync.

**H**'s qr-07 and **I**'s h23/qr-06 are demoted to `fix-on-touch`; qr-03 (Medium, `needs-info`) was
never in scope for demotion. **L** is the user's, not an agent's, and none of it is demoted — h35,
h25, and h24 need a dashboard/production check or a design go/no-go; qr-08 (Medium) was never in
scope; qr-09 and qr-11 each say outright they need a deliberate decision, not a fix.

---

## Fix-on-touch index (added 2026-09-05)

The Low-severity and Best-Practice tickets above are demoted to `fix-on-touch`:
not scheduled work, no dedicated commit, no dedicated review — fixed in passing
by whoever next edits the file they live in. This section is an **added index
by file**; it does not replace the cluster groupings above, which encode real
ordering constraints that a by-file listing can't express. See CONTRIBUTING.md's
"Review findings: what earns a ticket" for why these were demoted instead of
worked as their own slice.

**Excluded from demotion, kept at their scheduled status:** h36 and h13
(reverse or trade off a deliberate decision — cluster C), h35, h25, and h24
(need a dashboard/production check or a design go/no-go external to a code
edit — cluster L), qr-09 and qr-11 (both explicitly "needs a deliberate
decision," not a fix — cluster L). Every excluded ticket's own text says so;
this list was built by grepping for "deliberate decision" / "judgment call" /
"go/no-go" language across the demoted batch, not by severity alone.

**Also restored to scheduled status, 2026-09-05 (not excluded from the original
pass — corrected afterward on the user's call):** h18, h14, h15, qr-12, qr-13
(cluster E) — the blanket demotion was written for sub-five-minute fixes and
had swept up a ~900-line decomposition that explicitly needs a plan and
sign-off before any edit. See cluster E above for the full story.

| File | Tickets |
|---|---|
| `app/[sessionId]/page.tsx` | h19, h21(client side) |
| `app/api/sessions/[sessionId]/expenses/route.ts` | (h13 — not demoted, needs a real tradeoff decision, see cluster C) |
| `app/api/sessions/[sessionId]/settlements/route.ts` | h23 item 2 |
| `lib/expenseSession.ts` | h10 — **trap:** keep `_count: { select: { expenses: true } }`; never resolve a `tsc` error here by deleting the `session._count.expenses` destructure |
| `lib/fetcher.ts` | h21 |
| `app/api/sessions/[sessionId]/route.ts` | h11 |
| `app/api/sessions/[sessionId]/expenses/[expenseId]/route.ts` / participants routes / qr routes | h37 |
| `prisma/schema.prisma` | h22 (deprecated `nativeEnum`) |
| `tests/*.test.ts` | h23 remainder |
| `lib/storage.ts` | qr-06, qr-07 (qr-09 not demoted — needs a schema-change decision, see cluster L) |
| `components/PaymentAction.tsx` | (qr-11 not demoted — a trust-model accept/reject decision, see cluster L) |
| `app/[sessionId]/settle/page.tsx`, `app/[sessionId]/view/page.tsx` | h16, v1-07 |
| `app/page.tsx` | v1-09, v1-22 |
| various (see individual tickets) | v1-10 |
