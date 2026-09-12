Status: resolved
Severity: Medium
Category: Correctness

# capture="environment" on the QR file input may block picking an existing screenshot from the gallery

Both QR file inputs (add + replace) set `capture="environment"` alongside `accept="image/jpeg,image/png,image/webp"`. On Android Chrome and modern iOS Safari, `capture` is honored by opening the camera app directly, which forecloses the photo/gallery picker entirely. The realistic source of a QR image for this feature is a screenshot/export already saved from GCash/Maya/a bank app — exactly what `capture` removes access to. The only remaining path would be photographing a QR displayed on a second screen.

Location (at filing): app/[sessionId]/page.tsx:616, :642 — both inputs were later consolidated into components/QrFileInput.tsx (see ticket 13).

Found by: correctness-reviewer, Phase G.2 review (2026-08-16).

## Comments

**2026-08-22 — confirmed reproducing** on real production hardware: tapping "Add QR code" opens the camera directly, no gallery/photo-picker option. Fix deferred pending user confirmation before editing.

**2026-09-12 — resolved.** Dropped `capture="environment"` entirely (not a second control) and widened `accept` to `image/*`, since the narrow MIME list was also greying out valid photos in the picker with no server-side benefit — `lib/imageCompress.ts` re-exports every upload to JPEG regardless of input format, so `accept` was advisory-only. Ticket 13 (JSX duplication) was pulled forward from BACKLOG cluster E in the same session, since this fix would otherwise have had to be applied in two places; see that ticket for detail.

Reviewed by correctness-reviewer, security-reviewer, and best-practice-reviewer in parallel (full diff context, see `.scratch/plans/v2-qr-review-fixes.md`). Correctness and security: no findings. Best-practice: one finding (a history-narrating comment in the new `components/QrFileInput.tsx`, fixed same session).

**Proof the fix works:** confirmed on real mobile hardware post-deploy — the photo picker now offers both Photo Library and Take Photo. This is the same device-test category that first confirmed the bug, so it directly closes the loop. `npx tsc --noEmit` and lint clean; no automated test covers this path (repo has no browser-level test tooling), so the device confirmation is the verification of record, not a test run.

Committed and pushed as `4de6022` ("Fixed QR code upload from mobile gallery").
