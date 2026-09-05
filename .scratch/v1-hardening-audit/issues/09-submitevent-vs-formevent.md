Status: fix-on-touch (was: backlog (not blocking V1 close))
Severity: Low
Category: Best-practice

# Nonstandard event type React.SubmitEvent

page.tsx:37 and [sessionId]/page.tsx:243 type the submit handler as React.SubmitEvent<HTMLFormElement>. The idiomatic React type is React.FormEvent<HTMLFormElement> (SubmitEvent is a DOM global, not the conventional React namespace type).

Fix sketch: swap for FormEvent in both locations.
