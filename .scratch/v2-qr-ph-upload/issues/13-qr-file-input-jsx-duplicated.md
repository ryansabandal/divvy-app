Status: ready-for-agent
Severity: Low
Category: Best-Practice

# QR file-input JSX duplicated between the "add" and "replace" branches

The "has QR" (Replace) and "no QR" (Add QR code) branches in the QR tab each render a near-identical ~15-line file-input block — same accept/capture/disabled/className, and an identical onChange closure — differing only in button label text and wrapper class. Any future change to accepted file types, upload-trigger logic, or the disabled condition has to be made in two places ~30 lines apart inside a ternary.

Location: app/[sessionId]/page.tsx:596-628 and :629-643

Fix sketch: extract a small `QrFileInput` (or similar) component/render-helper parameterized by label text and wrapper class, used by both branches.

Found by: best-practice-reviewer, Phase G.2 review (2026-08-16).

## Comments

**2026-09-05 — restored from `fix-on-touch`**, alongside h18/h14/h15/qr-12. This ticket lives inside
the `PaymentMethodEditor` that h18's decomposition extracts — see `.scratch/BACKLOG.md` cluster E —
so it rides with that cluster's restoration rather than being fixed standalone; see h18's comment
for the full reasoning.
