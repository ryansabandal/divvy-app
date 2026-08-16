Status: needs-info
Severity: Medium
Category: Correctness

# capture="environment" on the QR file input may block picking an existing screenshot from the gallery

Both QR file inputs (add + replace) set `capture="environment"` alongside `accept="image/jpeg,image/png,image/webp"`. On Android Chrome and modern iOS Safari, `capture` is honored by opening the camera app directly, which forecloses the photo/gallery picker entirely. The realistic source of a QR image for this feature is a screenshot/export already saved from GCash/Maya/a bank app — exactly what `capture` removes access to. The only remaining path would be photographing a QR displayed on a second screen.

Location: app/[sessionId]/page.tsx:616, :642

Needs: a real mobile-browser test (Android Chrome + iOS Safari) to confirm the gallery picker is actually unreachable with `capture` set, before deciding the fix. Not verifiable in this environment.

Fix sketch (if confirmed): drop `capture="environment"`, or offer two separate controls (one plain file input for gallery, one with `capture` for camera).

Found by: correctness-reviewer, Phase G.2 review (2026-08-16).
