Status: backlog (not blocking V1 close)
Severity: Low
Category: Best-practice

# Outdated comment omits QUANTITY split type

[sessionId]/page.tsx:261 comment reads "Build the split portion of the payload differently for EVEN vs CUSTOM" but the code handles three modes (EVEN/CUSTOM/QUANTITY).

Fix sketch: update the comment to mention all three modes.

## Comments

Reviewed 2026-07-26 during the serverless migration's Phase 3 ticket fold-in: this ticket had been miscategorized into README's "Absorbed by Phase 3" disposition row (it's a stale frontend comment, unrelated to the backend route port that phase actually did). Moved to "untouched — pure frontend" in that table; still unfixed, still a trivial 1-line pickup whenever.
