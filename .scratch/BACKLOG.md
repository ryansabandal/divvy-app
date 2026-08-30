# Backlog index

**36 open tickets** across three review directories, grouped by the code they touch rather than by
the review that filed them. The directories stay as they are — they record provenance, and ~200
cross-references depend on the current numbering. This file is the grouping; it is a *view*, not a
move.

Ticket ids below are prefixed by origin, because the numbers collide across directories (there are
three `05`s, three `07`s, two `13`s):

| Prefix | Directory |
|---|---|
| `h` | `holistic-review-2026-08-28/issues/` |
| `v1` | `v1-hardening-audit/issues/` |
| `qr` | `v2-qr-ph-upload/issues/` |

Resolved tickets live in each directory's own `issues/resolved/` and are not listed here (37 of them).

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
**[h17](holistic-review-2026-08-28/issues/17-money-util-epsilon-sprawl.md)** · Low · epsilon and rounding sprawl
**[v1-05](v1-hardening-audit/issues/05-money-rounding-util.md)** · Medium · no money util — **part (a) done**

h07 shipped `lib/money.ts` `distributeCents()`, called by both the EVEN and QUANTITY branches of
`buildExpenseSplits()`. That closes v1-05's "factor remainder-distribution into one function" and
h17's part (a), and removes every `Math.round(x * 100) / 100` from `lib/expenseSplits.ts`. h23
item 1 (exact `toBe` on the remainder assertions) went with it, as planned.

**What is left in this cluster is one pure-refactor commit.** `roundToCents()` was deliberately
*not* shipped with h07 — that fix removes its last call site in `expenseSplits.ts`, so it would
have landed as an unused export (the exact smell ticket 30 was filed for). Add it next to
`distributeCents()` in the same commit as its real call sites: rename `lib/expenseBreakdown.ts:41`'s
misnamed `toCents()` (returns pesos, not centavos), drop `components/ExpenseBreakdown.tsx:8`'s
re-declared `CENT_EPSILON` for an import of `RECONCILED_EPSILON`, and replace the bare `0.01`
literals in `lib/settlementHelpers.ts` and `app/[sessionId]/page.tsx`.

**Carry forward:** `distributeCents()` guarantees an exact sum *in centavos*. Peso sums are still
floats — the 18-way ₱1.00 split adds up to `1.0000000000000004` — so check the specific addition
before pinning any total with an exact assertion.

## B · Settlements route: queries and ordering

**[h08](holistic-review-2026-08-28/issues/08-settlements-findmany-no-orderby.md)** · Low · frozen settlements returned with no `orderBy`
**[h09](holistic-review-2026-08-28/issues/09-settlements-route-redundant-queries.md)** · Low · route re-fetches names it already holds

Both rewrite the same two calls: `settlements/route.ts:30-33` (GET) and `:95-98` (POST).

**Coupled through row order, not merely adjacent.** h09 switches POST to `createManyAndReturn`
(insertion order — the greedy plan's order); h08 sets GET's order. If those differ,
`tests/sessions.integration.test.ts:1341` breaks the moment a fixture yields 2+ rows, which is
exactly the latent flakiness h08 predicts. One shared decision.

**Blocking decision — h08's suggested fix is not implementable as filed.** `Settlement` has no
`created_at` and no `sort_order` (verified against `prisma/schema.prisma`), so "the settlement's own
creation order" does not exist. Real options: `orderBy: { id: "asc" }` (stable but arbitrary — random
v4 UUIDs — and POST must sort identically), or add `sort_order` to `Settlement` to preserve the
plan's largest-debts-first order, matching what `Participant`/`Expense` already do. The latter costs
a migration.

`createManyAndReturn` is confirmed present in the generated client.

## C · Expenses route: cap and reorder under load

**[h36](holistic-review-2026-08-28/issues/36-expense-cap-not-enforced-under-concurrency.md)** · Medium · cap is advisory only (reproduced at 700 concurrent)
**[h13](holistic-review-2026-08-28/issues/13-reorder-one-update-per-expense.md)** · Low · one UPDATE per expense in the reorder transaction

They interact: h36's third option is "drop `MAX_REORDER_IDS` so overshoot is never fatal," which
changes what h13 is optimizing. Decide h36's direction before touching h13's transaction.

Both `needs-triage`-grade decisions. h36 reverses ticket 28's deliberate choice against locking.

## D · Route hardening — small, independent, shippable now

**[h38](holistic-review-2026-08-28/issues/38-unbounded-amount-overflows-settlement-plan.md)** ·
**High** · unbounded `amount` overflows to `Infinity` — **do this one first**.
A single expense blanks every amount in the settlement plan (`Infinity` serialises to JSON `null`);
50 of them hang `computeSettlements` in a non-terminating loop and brick the session. Pre-existing,
not introduced by h07. Fix is one `.max()` on the shared `amount` field in `schemas/sessions.ts`
plus an iteration bound on the `while` loop in `lib/settle.ts`. Filed 2026-08-30.


**[h10](holistic-review-2026-08-28/issues/10-loadsessionparticipants-overfetch.md)** · Low · narrow the `include` to `select: { id: true }`
**[h37](holistic-review-2026-08-28/issues/37-participant-qr-routes-unguarded-p2025.md)** · Low · apply `isMissingRowError()` to 3 more routes
**[h21](holistic-review-2026-08-28/issues/21-fetcher-error-messages-swapped.md)** · Low · two mislabeled fetcher strings

No dependencies on anything else. h10 **must keep `_count: { select: { expenses: true } }`** or the
expense cap breaks — `tsc` catches it, but the fix is to keep `_count`, never to delete the
destructure to quiet the compiler. h37 is a mechanical copy of the settlement PATCH shape.

## E · Frontend: session-page decomposition — BLOCKED on a plan

**[h18](holistic-review-2026-08-28/issues/18-sessionpage-decomposition.md)** · Low · ~900-line component, four concerns
**[h14](holistic-review-2026-08-28/issues/14-sessionpage-rerender-coupling.md)** · Low · full list re-render per keystroke
**[h15](holistic-review-2026-08-28/issues/15-expenserow-extraction-scope.md)** · Low · `ExpenseRow` extraction
**[qr-12](v2-qr-ph-upload/issues/12-payment-method-label-logic-duplicated.md)** · Low · label mapping across three call sites
**[qr-13](v2-qr-ph-upload/issues/13-qr-file-input-jsx-duplicated.md)** · Low · QR file-input JSX duplicated

h18 and h14 state outright they must be done together — the same extraction fixes both the file size
and the re-render coupling. h15's `ExpenseRow` gets its natural home inside h18's structure.

**Both qr tickets belong here**, which neither ticket says: qr-12 and qr-13 live inside the
`PaymentMethodEditor` that h18 extracts. Working them separately means touching that JSX twice.

Largest change in the backlog. Needs a decomposition plan (what components, what props, what stays
in the parent) and sign-off before any edit.

## F · Frontend: shared extraction outside the big decomposition

**[h16](holistic-review-2026-08-28/issues/16-settlementrow-extraction.md)** · Low · `SettlementRow` duplicated between settle and view
**[v1-07](v1-hardening-audit/issues/07-dedupe-finalize-recalculate.md)** · Low · `handleFinalize`/`handleRecalculate` near-identical
**[h19](holistic-review-2026-08-28/issues/19-copy-to-clipboard-triplicated.md)** · Low · copy-to-clipboard implemented three times, drifted timeout

**These do not depend on cluster E**, despite h16's own "plan together" note. h16 and v1-07 both
touch `settle/page.tsx` and `view/page.tsx` only; h19 is a hook that survives any later
restructuring. All three are shippable today.

## G · Frontend: data fetching and payload

**[h11](holistic-review-2026-08-28/issues/11-session-get-participant-payload-duplication.md)** · Low · full participant embedded under every payer and split
**[h12](holistic-review-2026-08-28/issues/12-mutations-discard-response-refetch-graph.md)** · Low · every mutation refetches the whole session graph

h12 explicitly builds on h11's characterization of the session GET, and h12's fix reduces how often
h11's bloated payload is fetched. **h11 is `needs-triage`** — its recommended option changes the wire
contract and needs confirmation before implementing.

## H · QR display robustness

**[qr-07](v2-qr-ph-upload/issues/07-dangling-qr-image-no-fallback.md)** · Low · dangling QR renders as a broken image
**[qr-03](v2-qr-ph-upload/issues/03-qr-upload-capture-environment-blocks-gallery.md)** · Medium · `capture="environment"` may block gallery picking

Both touch the QR `<img>`/input surface in `PaymentAction.tsx` and `app/[sessionId]/page.tsx`.
qr-03 is `needs-info` — it needs a real device check, and the user asked to confirm before changing it.

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
- **Items 2 and 3 → blocked on h08** (cluster B). Item 3 says so outright.

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

## K · Docs — do LAST

**[h20](holistic-review-2026-08-28/issues/20-claude-md-stale-schema-block.md)** · Medium · CLAUDE.md's schema block contradicts `schema.prisma` and its own prose

h20 absorbed ticket 33 and says to re-diff rather than trust its enumerated list. **Every cluster
above changes what CLAUDE.md has to say** — a new `lib/money.ts`, possibly a `Settlement.sort_order`
migration, a renamed helper, new components. Doing this before them guarantees doing it twice.

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
2. **A** — the h17 remainder, as its own refactor commit. ← **next**
3. **B** — h08 + h09 + h23 items 2/3, once the `orderBy` decision is made.
4. **D** — h10, h37, h21. Plus **F** (h16, v1-07, h19), which is independent.
5. **J** — papercuts.
6. Decisions: **C** (h36 direction), **G** (h11 wire contract), then **E** with a plan.
7. **K** last.

**H**, **I** items 4/5/6, and **qr-06** slot in anywhere. **L** is the user's, not an agent's.
