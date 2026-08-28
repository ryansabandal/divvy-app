Status: ready-for-agent
Severity: Medium
Category: Correctness

# Malformed non-empty JSON returns an unhandled 500, not a 400

`parseJsonBody()` calls `JSON.parse(text)` with no surrounding `try`/`catch`, and `parseBody()` doesn't wrap it either. Any route receiving a truncated/malformed (but non-empty) JSON body — e.g. `{"name":"x"` — throws an uncaught `SyntaxError`, producing a raw 500.

Location: lib/requestBody.ts:12

The comment directly above the code claims this mirrors Express: "Genuinely malformed (non-empty) JSON still throws here, same as Express." That premise is false — `express.json()` attaches `status: 400` to its `SyntaxError`, and Express's default error handler honors it, turning malformed JSON into a clean 400 in the original app. So this isn't a documented, intentional decision being preserved — it's a decision resting on an incorrect parity claim.

Fix: wrap the `JSON.parse` call in `parseJsonBody` (or in `parseBody`) so a `SyntaxError` produces the same clean 400 every other bad request body already gets, matching the pattern Zod validation failures already use. Correct the comment once the false Express-parity claim is removed.

Test gap: no test in the suite sends malformed JSON to any route — add one.

Found by: correctness-reviewer, holistic review (2026-08-28).
