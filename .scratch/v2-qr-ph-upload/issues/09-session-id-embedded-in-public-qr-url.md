Status: needs-triage
Severity: Low
Category: Security

# The session id (the app's only credential) is embedded in the public, shareable QR image URL

`qr_code_url` serializes to a URL containing the raw `sessionId` in its path. The session id is this app's sole access token — anyone holding it can read and edit the whole session. The QR is deliberately rendered as a plain `<img>` specifically so native long-press/right-click "save image" works (a hard UX requirement — "the payer needs to walk away with the image"), and that same context menu offers "Copy image address" / "Open image in new tab" right next to "Save image." A payer who shares the QR *link* instead of the saved file hands a third party the session id along with it — a second, easier-to-leak carrier for the credential beyond the app URL group members already hold.

Location: lib/storage.ts:27-30 (qrObjectPrefix) -> lib/storageUrl.ts:4-8 -> components/PaymentAction.tsx:88,108

Needs triage: fix requires a schema change (an opaque per-session storage folder token on the Session row, used in the object prefix instead of the raw sessionId) — bigger scope than a one-line patch, worth a deliberate go/no-go given the bucket is already public-read under the app's existing "anyone with the link" trust model.

Found by: security-reviewer, Phase G.2 review (2026-08-16).
