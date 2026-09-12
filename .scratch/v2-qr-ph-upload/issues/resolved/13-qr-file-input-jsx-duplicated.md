Status: resolved
Severity: Low
Category: Best-Practice

# QR file-input JSX duplicated between the "add" and "replace" branches

The "has QR" (Replace) and "no QR" (Add QR code) branches in the QR tab each render a near-identical ~15-line file-input block — same accept/capture/disabled/className, and an identical onChange closure — differing only in button label text and wrapper class. Any future change to accepted file types, upload-trigger logic, or the disabled condition has to be made in two places ~30 lines apart inside a ternary.

Location (at filing): app/[sessionId]/page.tsx:596-628 and :629-643

Found by: best-practice-reviewer, Phase G.2 review (2026-08-16).

## Comments

**2026-09-05 — restored from `fix-on-touch`**, alongside h18/h14/h15/qr-12. This ticket lives inside
the `PaymentMethodEditor` that h18's decomposition extracts — see `.scratch/BACKLOG.md` cluster E —
so it rides with that cluster's restoration rather than being fixed standalone; see h18's comment
for the full reasoning.

**2026-09-12 — pulled forward and resolved**, ahead of the cluster E decomposition it was riding
with. Ticket 03's fix (dropping `capture`, widening `accept`) needed to touch both copies of this
JSX; extracting first meant the fix landed once instead of twice, per this ticket's own fix sketch.
Extracted `components/QrFileInput.tsx` — a named export following the `components/ExpenseRow.tsx`
convention (inline prop types, per-prop comments), taking `label`/`uploading`/`disabled`/`className`/
`onFile` so it carries no knowledge of the caller's `qrAction` state shape. Both branches in
`app/[sessionId]/page.tsx` now render it.

This does **not** close h18/cluster E — the `PaymentMethodEditor` decomposition itself is still
deferred and unplanned. `QrFileInput` is forward-compatible with it: a future `PaymentMethodEditor`
would import this component, not reshape it, so nothing here needs redoing when that ticket starts.
See `.scratch/BACKLOG.md` cluster E for the updated cross-reference.

Reviewed by correctness-reviewer, security-reviewer, and best-practice-reviewer in parallel alongside
ticket 03's fix (same diff). No correctness or security findings against the extraction itself.
Best-practice flagged one issue in the new file's header comment (history narration, violating the
"keep rationale/history out of code comments" rule) — fixed same session.

**Proof:** `npx tsc --noEmit` and lint clean; `grep -rn 'type="file"'` confirms `QrFileInput.tsx` is
now the only file-input element in the repo (previously two, byte-identical). Desktop smoke test
(add/replace/remove QR) confirmed unchanged behavior post-extraction. No automated test covers this
component — repo has no browser-level test tooling.

Committed and pushed as `4de6022` ("Fixed QR code upload from mobile gallery").
