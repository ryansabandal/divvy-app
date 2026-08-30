Status: ready-for-agent
Severity: High
Category: Security

# Unbounded `amount` overflows to Infinity — corrupts the settlement plan, and a 50-expense burst hangs the settlements endpoint

`expenseBase.amount` in `schemas/sessions.ts` is `z.number().positive().finite()` with **no upper bound**. Every split type shares that field, so this reaches EVEN, CUSTOM, and QUANTITY alike. The app has no authentication by design — anyone with a session link can POST expenses — so this is reachable by any link holder.

## Two distinct consequences, both reproduced

**1. Corrupted settlement plan — one request.** A single expense with `amount: 1e308` is a legal finite double, so it passes Zod and persists into `DOUBLE PRECISION` without complaint. `computeNetBalances` then produces balances of `±1e308`, and in `computeSettlements` (`lib/settle.ts:43`) `Math.round(Math.min(...) * 100) / 100` overflows to `Infinity`. `JSON.stringify({ amount: Infinity })` yields `{"amount": null}`, so `GET .../settlements` shows **every participant a blank amount owed**, and `POST .../settlements` writes `Infinity` into `Settlement.amount`, freezing the corrupted plan permanently.

**2. Unbounded loop — 50 expenses.** `computeSettlements`'s `while` loop advances an index only when a balance falls to `<= RECONCILED_EPSILON`. If a *balance* is `Infinity`, then `amount` is `Infinity` too, and `Infinity - Infinity` is `NaN`; `NaN <= 0.005` is `false`, so neither `i` nor `j` ever advances and the loop pushes rows forever. Reproduced: **200,000+ iterations, still spinning**, `settlements` growing unboundedly. Any later `GET` or `POST .../settlements` on that session pins CPU and grows heap until the Vercel function is killed — the session is bricked for every participant, repeatably.

## Correction to the original report — the mechanism matters for the fix

The 3-lens review (2026-08-30, security lens) reported consequence 2 as triggerable by a *single* `1e308` expense, via both balances going `NaN`. **That is wrong and was disproved by direct execution.** With a finite balance of `1e308` and `amount = Infinity`, `1e308 - Infinity` is `-Infinity`, not `NaN` — which *satisfies* `<= RECONCILED_EPSILON`, advances the index, and terminates the loop in **one iteration**.

The hang needs the **balance itself** to overflow, which takes a burst: `50 × 1e307` sums to `Infinity`, and 50 is exactly `MAX_EXPENSES_PER_SESSION`.

Two consequences for the fix:
- The `amount` ceiling must be low enough that **50 summed expenses** cannot overflow, not merely one.
- Bounding the `while` loop is **load-bearing, not defence in depth** — the actual failure is `NaN` propagation defeating the loop's only exit condition, which a value ceiling addresses upstream but does not make structurally impossible.

## Fix

Bound the shared field, so all three split types are covered at once — a per-branch fix would leave CUSTOM open:

```ts
amount: z.number().positive("amount must be a positive number").finite()
  .max(100_000_000, "amount is too large"),
```

Any ceiling at or below ~1e12 removes both consequences with margin: 50 x 1e12 pesos is 5e15 centavos, still under 2^53 (~9.007e15), so `Math.round(amount * 100)` stays exact and `computeNetBalances` cannot overflow.

**Bounding `amount` alone is not sufficient — the `units` bound below is part of this fix, not a follow-up.** `distributeCents` computes `totalCents * w`, where `w` is a participant's `units`. With `units` unbounded, that product leaves the exact-integer range regardless of the amount ceiling: at the recommended `amount` cap of `100_000_000`, a single `units: 1e9` gives `totalCents * w = 1e19`, far past 2^53. Verified. Capping `units` at `10_000` keeps the product exact (`1e14`).

Separately, bound `computeSettlements`'s loop by `creditors.length + debtors.length` iterations so a `NaN` balance can never make it non-terminating regardless of what upstream validation allows.

**All three parts ship together** — the `amount` ceiling, the `quantity`/`units` ceilings, and the loop bound. Any one alone leaves a reachable path open.

## Not introduced by ticket 07

Pre-existing. The old `Math.round((amount / n) * 100) / 100` overflowed at the same thresholds; ticket 07's `Math.round(amount * 100)` inherits the exposure rather than creating it. Filed separately rather than folded into 07's commit because the root cause is a different file (`schemas/sessions.ts`), the severity is far higher, and a High security fix buried in a Low-severity rounding commit is one nobody reviews as such.

Related: `lib/money.ts`'s `distributeCents()` documents an exact-sum invariant that silently evaporates for these inputs. The value bound restores it; no change to `money.ts` is needed.

## The `quantity` / `units` ceiling — required by the above, and independently a bug

`quantity` and `units` are `z.number().int().positive()` with no ceiling, while `Expense.quantity` is `int4`. `quantity: 4000000000` passes Zod and every in-app guard, then fails at the Postgres write with `22003` as an **unhandled 500** rather than the 400 every other malformed-input path returns. Impact is limited (Next.js returns a generic error in production, so nothing leaks), but the fix is the same one line: `.max(...)` on both fields, any ceiling under `2_147_483_647`.

Found by: 3-lens review of the ticket 07 slice (2026-08-30), security lens; both consequences re-executed and the stated mechanism for consequence 2 corrected by the orchestrating session.
