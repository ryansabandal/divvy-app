Status: ready-for-agent
Severity: Low
Category: Performance

# Every mutation discards the response it just got and re-fetches the whole session graph

`handleSavePaymentMethod`, `handleQrUpload`, `handleQrRemove`, `handleDeleteExpense`, and `handleSubmitExpense` in the session page all call a bare `await mutate()` after their mutation, which triggers a full `GET /api/sessions/:sessionId` (the ~6-query, participant-duplicating request — see ticket 11) even though the mutating route already computed and returned the exact row that changed. `POST /expenses`, for instance, explicitly includes `{ payer: true, splits: { include: { participant: true } } }` in order to serialize the created row — and the client throws that response away.

Location: app/[sessionId]/page.tsx — handleSavePaymentMethod:295, handleQrUpload:332, handleQrRemove:349, handleDeleteExpense:367, handleSubmitExpense:585

Sharpest instance: `handleDragEnd:397` calls bare `await mutate()` on the **success** path of a drag-drop, where the optimistic local state already equals exactly what the server now holds (the client sent the new order and the server just wrote it back verbatim) — a full session-graph GET fetched for zero new information, on every single drop.

Precedent: resolved ticket `19-reorder-response-unused.md` already established this class of finding is worth fixing; README:304 documents "mutate() refetches after mutations" as the current behavior (a description, not a reasoned decision), so this isn't re-litigating a documented tradeoff.

Fix: use SWR's `mutate(key, data, { revalidate: false })` (or the newer `mutate(promiseOrData)` form) to update the local cache directly from the mutation's own response where the shape matches, instead of discarding it and refetching. For `handleDragEnd`'s success path specifically, skip the `mutate()` call entirely — the optimistic state is already correct.

Found by: best-practice-reviewer, holistic review (2026-08-28).
