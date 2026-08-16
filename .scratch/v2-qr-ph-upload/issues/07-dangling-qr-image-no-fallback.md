Status: ready-for-agent
Severity: Low
Category: Correctness

# A missing/dangling QR object renders as a broken image with no UI fallback

PUT persists a client-supplied path without verifying the object actually exists in Storage, and none of the three `<img>` tags rendering a QR (page.tsx's own thumbnail, PaymentAction.tsx's thumbnail + enlarged view) has an `onError` handler. If a row ever points at a missing object — via ticket 02's failure modes, or any client that PUTs a path whose upload never landed — every viewer sees a broken-image icon with no indication the participant needs to re-upload, and the session owner sees "QR code ✓" on the collapsed row regardless.

This is distinct from the CLAUDE.md-accepted "orphaned object" risk (an object nothing references) — this is a reference to a missing object, which is directly user-visible.

Location: components/PaymentAction.tsx:87, :107; app/[sessionId]/page.tsx:605

Fix sketch: add an `onError` handler that swaps to a "QR image unavailable — ask them to re-upload" state instead of a broken `<img>`.

Found by: correctness-reviewer, Phase G.2 review (2026-08-16).
