Status: resolved
Severity: Medium
Category: Correctness

# QR-only participant's row expands onto the GCash tab, not the QR tab

`setActiveTab(p.payment_method_type || "GCASH")` in the expand handler ignores `qr_code_url`. A participant who has uploaded a QR but never set a phone/bank method has `payment_method_type === null`, so expanding their row opens the GCash tab with an empty phone field — even though the collapsed row correctly shows "QR code ✓" one line away.

Location: app/[sessionId]/page.tsx:206 (toggleExpandParticipant)

Fix sketch: `setActiveTab(p.payment_method_type || (p.qr_code_url ? "QR" : "GCASH"))`.

Found by: correctness-reviewer, Phase G.2 review (2026-08-16).

Resolved 2026-08-22: applied the fix sketch verbatim. Re-reviewed clean by a scoped correctness-reviewer subagent, which confirmed `qr_code_url` is a non-optional, always-populated field and participants never reach this call site partially hydrated.
