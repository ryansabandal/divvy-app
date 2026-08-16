Status: ready-for-agent
Severity: Low
Category: Best-Practice

# Missing why-comment on file-input value reset; dead defensive guard in handleSavePaymentMethod

Two small nits from the same pass, both trivial to fix together:

1. `e.target.value = "";` (both file-input onChange closures) has no comment explaining why it's there — it resets the input so re-picking the *same* file re-fires onChange (browsers otherwise suppress the change event for an unchanged selection). Per CLAUDE.md's comment convention (a comment for anything non-obvious), this is exactly the kind of line a future editor might "clean up" as dead code, silently breaking re-upload-the-same-file.
2. `handleSavePaymentMethod` opens with `if (activeTab === "QR") return;` labeled "defensive." The Save button that calls this function is only ever rendered when `activeTab !== "QR"`, and both are recreated together each render, so there's no reachable path that hits this branch — it's speculative error handling for a scenario that can't happen, which CLAUDE.md's engineering principles call out directly ("don't add error handling for scenarios that can't happen").

Location: app/[sessionId]/page.tsx:621, :647 (comment); app/[sessionId]/page.tsx:224 (dead guard)

Fix sketch: add the one-line "why" comment to the value reset; remove the dead guard (the real invariant already lives in the JSX conditional gating the Save button).

Found by: best-practice-reviewer, Phase G.2 review (2026-08-16).
