Status: needs-triage
Severity: Low (informational)
Category: Security

# A swapped QR is harder for a victim to notice than a swapped phone number

Any session-link holder can PUT their own QR onto another participant's row, redirecting that creditor's incoming payments. This is not a new authorization gap — it's byte-for-byte the same "anyone with the link can edit any participant" model the existing PATCH .../participants/:participantId route already has, which CLAUDE.md explicitly accepts (attachments don't warrant a stricter standard than the data beside them). What's new is *detectability*: a swapped phone number/account is rendered as visible text next to its owner's name, so a wrong value is obvious at a glance; a QR is opaque to both the victim and the payer without actually scanning it, so a swap is much harder to catch.

Location: app/api/sessions/[sessionId]/participants/[participantId]/qr/route.ts:38-72 (PUT)

Needs triage: not a code fix so much as a conscious accept/reject of an already-existing trust model extended to a less-detectable data type. Worth a deliberate decision rather than inheriting it silently.

Found by: security-reviewer, Phase G.2 review (2026-08-16).
