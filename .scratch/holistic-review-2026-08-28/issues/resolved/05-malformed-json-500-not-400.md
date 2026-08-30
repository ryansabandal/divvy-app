Status: resolved
Severity: Medium
Category: Correctness

# Malformed non-empty JSON returns an unhandled 500, not a 400

`parseJsonBody()` calls `JSON.parse(text)` with no surrounding `try`/`catch`, and `parseBody()` doesn't wrap it either. Any route receiving a truncated/malformed (but non-empty) JSON body — e.g. `{"name":"x"` — throws an uncaught `SyntaxError`, producing a raw 500.

Location: lib/requestBody.ts:12

The comment directly above the code claims this mirrors Express: "Genuinely malformed (non-empty) JSON still throws here, same as Express." That premise is false — `express.json()` attaches `status: 400` to its `SyntaxError`, and Express's default error handler honors it, turning malformed JSON into a clean 400 in the original app. So this isn't a documented, intentional decision being preserved — it's a decision resting on an incorrect parity claim.

Fix: wrap the `JSON.parse` call in `parseJsonBody` (or in `parseBody`) so a `SyntaxError` produces the same clean 400 every other bad request body already gets, matching the pattern Zod validation failures already use. Correct the comment once the false Express-parity claim is removed.

Test gap: no test in the suite sends malformed JSON to any route — add one.

Found by: correctness-reviewer, holistic review (2026-08-28).

## Comments

**2026-08-29 — fixed.** The `try` went into `parseBody`, **not** `parseJsonBody`. Catching inside the parser would have to return `undefined`, which is indistinguishable from the legitimate empty-body case — the response would then blame a missing field for what is actually unparseable JSON. Keeping the catch one level up preserves a precise message: 400 `"request body is not valid JSON"`.

`parseJsonBody` is now **un-exported**. It had exactly one consumer, in the same file, and its contract is "parse or throw"; leaving it exported was an open invitation back into this bug. Grepped every `.ts`/`.tsx` in the repo first — no other reference, no test import — so the contract change is fully contained.

The ticket's central claim checks out: `express.json()` really does attach `status: 400` to its `SyntaxError` and the default handler honors it, so the old comment had the original app's behaviour backwards. Replaced it with what Express actually does, so the next reader doesn't have to re-derive it.

Verified live:

| Body | Before | After |
|---|---|---|
| `{"name":"x` | 500 | **400** `request body is not valid JSON` |
| *(empty)* | 400 Zod message | unchanged |
| `{"nope":1}` | 400 Zod message | unchanged |
| valid | 201 | unchanged |

The empty-body row is the one that constrained the fix: existing integration tests assert that exact Zod message, so that path had to be left alone.

Malformed-JSON integration test still outstanding — step 9.
