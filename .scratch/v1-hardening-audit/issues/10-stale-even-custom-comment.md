Status: backlog (not blocking V1 close)
Severity: Low
Category: Best-practice

# Outdated comment omits QUANTITY split type

[sessionId]/page.tsx:261 comment reads "Build the split portion of the payload differently for EVEN vs CUSTOM" but the code handles three modes (EVEN/CUSTOM/QUANTITY).

Fix sketch: update the comment to mention all three modes.
