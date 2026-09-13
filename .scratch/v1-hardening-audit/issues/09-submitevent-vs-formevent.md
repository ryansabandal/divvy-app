Status: fix-on-touch (was: backlog (not blocking V1 close))
Severity: Low
Category: Best-practice

# Nonstandard event type React.SubmitEvent

page.tsx:37 and [sessionId]/page.tsx:243 type the submit handler as React.SubmitEvent<HTMLFormElement>. The idiomatic React type is React.FormEvent<HTMLFormElement> (SubmitEvent is a DOM global, not the conventional React namespace type).

Fix sketch: swap for FormEvent in both locations.

## Comments

**2026-09-13 — half-closed as fix-on-touch, during Cluster E Slice 3.** The `[sessionId]/page.tsx`
site moved (with the fix applied) into the new `app/[sessionId]/_components/ExpenseForm.tsx` as
part of an unrelated extraction that happened to touch this exact line — swapped to
`React.FormEvent<HTMLFormElement>` in the move. `app/page.tsx:37`'s copy is untouched and still
open; `Status:` stays `fix-on-touch` until that site is also touched.
