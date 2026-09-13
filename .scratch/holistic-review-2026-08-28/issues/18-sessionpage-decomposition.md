Status: resolved
Severity: Low
Category: Best-Practice

# `SessionPage` is a ~900-line component holding four unrelated concerns

`app/[sessionId]/page.tsx` (1042 lines, the largest file in the repo by 2x) holds 20 `useState` hooks spanning: the add/edit expense form, the payment-method editor (tabs, bank fields, QR upload/remove), drag-and-drop reordering, and two independent clipboard buttons. It has (at minimum) two Fowler-catalog Divergent Change axes in one file — a payment-method change and an expense-form change both require editing this same file.

Location: app/[sessionId]/page.tsx:123-1042

This is a maintainability finding on its own, and it also causes the performance issue in ticket 14 (sessionpage-rerender-coupling) — form keystrokes re-render the whole expense list because form state and list-rendering state live in the same component. The two tickets should be executed together: extracting `PaymentMethodEditor` and `ExpenseForm` into their own components (each owning its own state) fixes the re-render coupling and the file size in the same move, and gives the `ExpenseRow` extraction (ticket 15) a natural home to be wrapped inside.

Needs triage — this is the largest single change surfaced in the review and touches most of the file. Needs a decomposition plan (what components, what props, what stays in the parent) before starting, not a direct fix-sketch application.

Found by: best-practice-reviewer, holistic review (2026-08-28).

## Comments

**2026-09-05 — restored from `fix-on-touch`.** Swept into the 2026-09-05 blanket demotion of open
Low tickets along with h14, h15, qr-12, qr-13; that policy targets sub-five-minute opportunistic
fixes (CONTRIBUTING.md's "Review findings: what earns a ticket"), which this ticket's own text
already contradicts ("largest single change... needs a decomposition plan... before starting").
User confirmed: restore to scheduled status. Still needs the decomposition plan this ticket asks
for before any edit — that plan is the actual next step, not yet written.

**2026-09-12 — two riders resolved and pulled out individually, not as part of this decomposition.**
h15 (`ExpenseRow`) shipped in `75e2f9a`; qr-13 (QR file-input JSX) shipped in `4de6022`, pulled forward
because ticket qr-03's fix would otherwise have touched that JSX twice. Both landed as standalone
components (`components/ExpenseRow.tsx`, `components/QrFileInput.tsx`) that a future
`PaymentMethodEditor`/decomposition would import, not reshape — so this doesn't reduce what h18 itself
still needs (the decomposition plan is still unwritten), only removes two items from its rider list.
Remaining riders: h14, qr-12. See `.scratch/BACKLOG.md` cluster E.

**2026-09-13 — resolved.** Slice 2 (`PaymentMethodEditor` extraction, closes qr-12 too) and Slice 3
(`ExpenseList`/`ExpenseForm` extraction, closes h14 too) both shipped this session, each 3-lens
reviewed and fixed. `app/[sessionId]/page.tsx` went from 1046 lines (four unrelated concerns) to
~255 lines holding only the participant list, session-payer picker, and the two extracted
components. Verified via `tsc`/lint/unit/integration tests plus a scripted Playwright walkthrough.
Full detail: CHANGELOG.md's dated "Cluster E Slice 2" and "Cluster E Slice 3" entries,
`.scratch/plans/session-page-decomposition.md`.
