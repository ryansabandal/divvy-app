Status: fix-on-touch (was: ready-for-agent)
Severity: Low
Category: Best-Practice

# Copy-to-clipboard implemented three times, with a drifted timeout

Copy-to-clipboard-with-a-"Copied!"-reset is implemented independently in three places: `app/[sessionId]/page.tsx:1010-1020` and `:1023-1033` (both use a 2000ms reset), and `components/PaymentAction.tsx:25-29` (uses 1500ms). The differing timeout is the tell that this was copy-pasted rather than shared — nobody would deliberately choose two different reset durations for the same interaction pattern.

Location: app/[sessionId]/page.tsx:1010-1033; components/PaymentAction.tsx:25-29

Fix: extract a `useCopyToClipboard(resetMs = 2000)` hook (or similar) that all three call sites use, picking one canonical timeout.

Found by: best-practice-reviewer, holistic review (2026-08-28).
