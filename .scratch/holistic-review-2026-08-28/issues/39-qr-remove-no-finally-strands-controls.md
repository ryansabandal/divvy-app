Status: needs-triage
Severity: Medium
Category: Correctness

# `handleQrRemove` has no `finally`, so a rejected DELETE/refetch strands the QR controls disabled forever

`handleQrRemove` sets `qrAction("removing")`, then `await`s a `fetch(...DELETE)` and, on success, `await mutate()` — with `setQrAction(null)` as the last statement in the function body, not in a `finally`.

Location: `app/[sessionId]/_components/PaymentMethodEditor.tsx:129-139` (pre-existing bug, carried over verbatim from the same shape at the old `app/[sessionId]/page.tsx:322-332` before Cluster E Slice 2 extracted it — not introduced by that extraction).

Failure scenario: a participant taps Remove on their QR code. The DELETE request succeeds but the following `mutate()` refetch hits a network blip (or the DELETE itself rejects on a dropped mobile connection, common on the mobile-first flows this app targets). The rejection propagates out of `handleQrRemove` uncaught, so `setQrAction(null)` never runs. `qrAction` stays `"removing"` permanently: `disabled={qrAction !== null}` keeps both the Replace and Remove controls greyed out, the Remove button is stuck reading "Removing…", and `paymentMethodError` stays `null` so no error message ever appears to explain why. The only recovery is collapsing and re-expanding the row (discovered by re-reading `PaymentMethodEditor`'s remount-on-toggle behavior, not by anything the UI itself communicates).

The asymmetry with its own sibling handler is the tell: `handleQrUpload` twelve lines above wraps the identical await-fetch-then-mutate shape in `try/catch/finally { setQrAction(null) }`. `handleSavePaymentMethod` has the same missing-`finally` gap on its success path (`onClose(); await mutate();` with no error handling if `mutate()` itself rejects — though its early-return failure path does reset `savingPaymentMethod`, unlike `handleQrRemove`'s single unguarded happy path).

Fix: wrap `handleQrRemove`'s body in the same `try { ... } finally { setQrAction(null); }` shape `handleQrUpload` already uses, and set `paymentMethodError` in the `catch` so a real failure is visible rather than just recoverable.

Found by: correctness-reviewer, Cluster E Slice 2 review (2026-09-13). Reported as pre-existing per this repo's review triage bar (CONTRIBUTING.md) since it predates the extraction and the extraction's contract was "behavior identical" — not bundled as a fix in that diff so the refactor stays independently verifiable.
