# Divvy — Architecture (current state)

A simple bill-splitting app for friend groups. See [CLAUDE.md](CLAUDE.md) for full product scope. This README documents what's actually built so far and how the pieces fit together.

## Status

| Layer                       | Status                                                  |
| ---------------------------- | --------------------------------------------------------- |
| Local Postgres (Podman)      | ✅ Running via `compose.yml`                              |
| Prisma schema                | ✅ Sessions, participants (+ payment method), expenses, splits, settlements |
| Express API                  | ✅ All V1 routes built — see table below                  |
| Settlement algorithm         | ✅ `backend/src/lib/settle.ts`, greedy debt simplification |
| Frontend (Next.js)           | ✅ All V1 features built — create-session, session view (add/delete expenses: EVEN/QUANTITY/CUSTOM, per-person breakdown, inline payment-method entry), settle screen (finalize/recalculate/mark-as-paid/copy-to-pay, stale-plan warning), shareable read-only link (`/view`), design pass (navy/teal/sky-blue/beige/white) |
| Backend deployment           | ✅ Deployed on Railway (Express + PostgreSQL); URL lives in the Railway dashboard, not committed here |
| Frontend deployment          | ✅ Deployed on Vercel; URL lives in the Vercel dashboard, not committed here |
| Git / GitHub                 | ✅ Pushed to [github.com/ryansabandal/divvy-app](https://github.com/ryansabandal/divvy-app) (private) |
| Test coverage                | ✅ Vitest — 8 tests on `backend/src/lib/settle.ts`, the app's one piece of pure business logic |

> **Status:** V1 is **feature-complete, deployed, and formally closed** (2026-07-19). A full-repo hardening pass (audit + fixes) preceded closing it — see [Roadmap](#roadmap--next-steps) for exactly what was done.

## High-level flow

```
Browser
   │
   ▼
Next.js frontend
   │  HTTP/JSON
   ▼
Express API  (backend/src/index.ts)
   │  Prisma Client (driver adapter)
   ▼
PostgreSQL  (Podman container, compose.yml)
```

## Local dev environment

**`compose.yml`** defines one service: `db`, a `postgres:16` container exposed on `localhost:5432` with a named volume (`divvy_db`) so data survives restarts. This is the only containerized piece right now — backend/frontend still run directly on the host via `npm run dev`.

Run it with:
```
podman-compose up -d     # start Postgres
podman-compose down      # stop (keeps data — add -v to wipe the volume)
```

Why Podman instead of Docker: rootless and daemonless, per the engineering principles in CLAUDE.md.

## Backend (`backend/`)

```
backend/
├── prisma/
│   ├── schema.prisma          # data model (Session, Participant, Expense, ExpenseSplit, Settlement)
│   └── migrations/            # generated SQL migrations, applied to the Podman Postgres
├── prisma.config.ts           # tells the Prisma CLI how to connect (migrate, studio, etc.)
├── src/
│   ├── db.ts                  # creates the shared PrismaClient instance for the app
│   ├── index.ts               # Express app entrypoint — mounts sessionsRouter at /api/sessions
│   ├── routes/
│   │   └── sessions.ts        # all /api/sessions/* routes (session-scoped: participants, expenses, settlements)
│   └── lib/
│       ├── settle.ts          # pure function: net balances in, minimized payment list out — no Prisma/DB calls
│       └── settle.test.ts     # Vitest unit tests, incl. regression coverage for the residual-cent fix (see Roadmap)
├── .env                       # DATABASE_URL + PORT for local dev (not committed)
├── tsconfig.json
└── package.json
```

### Why two separate places configure the database connection

Prisma 7 removed the `url` field from `schema.prisma` itself. Connection strings now live in two places, for two different consumers:

- **`prisma.config.ts`** — used by the Prisma **CLI** (`prisma migrate dev`, `prisma studio`). Reads `DATABASE_URL` from `.env` directly.
- **`src/db.ts`** — used by the **running application**. Wraps a `pg` connection pool in a `PrismaPg` "driver adapter" and hands it to `PrismaClient`. This is Prisma 7's new no-Rust-engine mode — queries go straight through the `pg` driver instead of a bundled Rust binary.

Both ultimately point at the same `DATABASE_URL`, but the CLI and the app each need their own explicit wiring since the schema file no longer carries the connection itself.

### When the dev server seems to be running old code

`npm run dev` uses `ts-node-dev --respawn`, which watches files and restarts on change — but it's occasionally missed an edit and kept serving stale code (and a stale `@prisma/client`, if a migration happened in between). Symptom: a fix that should obviously work doesn't show up when you test it. Check `stat -c '%y %n' <file>` against `ps -o pid,lstart,cmd -p <pid>` for the `ts-node-dev` child process — if the file's mtime is newer than the process start time, restart it (`kill` the process, `npm run dev` again).

### Data model

Defined in `backend/prisma/schema.prisma`, mirrors the model in CLAUDE.md:

- **Session** — a bill-splitting group; has many participants, expenses, settlements.
- **Participant** — a person in a session; can pay for expenses, owe splits, owe/be owed settlements. Has an optional `payment_method_type` (`GCASH` | `MAYA` | `BANK_TRANSFER`) and `payment_details`, both nullable since they're self-entered later via the shared link, not at creation time. `sort_order` (an autoincrement int) keeps the participant list in a stable order — `created_at` alone can't do this, since Postgres's `now()` returns the *transaction* start time, so participants created together in one nested write (the normal case) all tie; `sort_order` is a real per-row sequence, immune to that and to later `UPDATE`s reshuffling physical row order.
- **Expense** — one logged cost, paid by one participant, split `EVEN` or `CUSTOM`.
- **ExpenseSplit** — per-participant share of one expense. `onDelete: Cascade` on its relation to `Expense`, so deleting an expense removes its splits automatically.
- **Settlement** — a frozen, simplified payment between two participants, with a `paid` boolean. Empty until the plan is finalized: `GET .../settlements` computes a live preview from current expenses when no rows exist yet, but once `POST .../settlements` freezes the plan, that becomes the source of truth and `paid` flags persist across visits.

### Request validation (`backend/src/schemas/sessions.ts`)

Request bodies are validated with **Zod** before any Prisma call. Two schemas are defined:

- `createSessionSchema` — validates `name` (non-empty string) and `participants` (array of non-empty strings, element-level check — the route previously only checked that the array was non-empty, so `["", null]` would reach Prisma).
- `createExpenseSchema` — a Zod discriminated union on `split_type` (`EVEN` | `CUSTOM` | `QUANTITY`), each variant with its own required fields. Replaces the previous `(s: any)` inline casts that gave TypeScript no runtime safety. After `safeParse` succeeds, TypeScript narrows the body type based on `split_type` — no casts in the route body.

DB-level checks (session existence, participant membership, split totals) remain in the route handlers since those require DB lookups that Zod can't do.

### Error handling (`backend/src/index.ts`)

A 4-argument Express error handler is registered after all routes. It logs the error server-side and returns `{"error": "..."}` JSON — a generic message in production (no stack-trace leak), the real message in development. Set `NODE_ENV=production` in Railway environment variables to activate the safe behaviour. Without this, Express 5's `finalhandler` would write the full stack trace into the response body.

### API routes (`backend/src/routes/sessions.ts`)

| Route | Status | Notes |
| --- | --- | --- |
| `POST /api/sessions` | ✅ | Creates a `Session` and all initial `Participant` rows in one Prisma nested write; validated via `createSessionSchema` |
| `GET /api/sessions/:sessionId` | ✅ | Returns the session with `participants` and `expenses` (with `payer` + `splits`) included |
| `POST /api/sessions/:sessionId/participants` | ✅ | Adds one participant to an existing session; 404s if the session doesn't exist |
| `PATCH /api/sessions/:sessionId/participants/:participantId` | ✅ | A participant sets their own `payment_method_type` + `payment_details` |
| `POST /api/sessions/:sessionId/expenses` | ✅ | EVEN / CUSTOM / QUANTITY split; validated via `createExpenseSchema`. EVEN rounding: per-cent rounding is reconciled by pushing the ±1¢ remainder onto the first participant's share, same as QUANTITY — without this, 3-way splits of ₱100 produce ₱99.99 total and settlements never net to zero |
| `DELETE /api/sessions/:sessionId/expenses/:expenseId` | ✅ | Removes an expense and its splits (cascade); scoped to the session so you can't delete another session's expense by id |
| `GET /api/sessions/:sessionId/settlements` | ✅ | Returns the frozen plan (with `paid` flags) if one exists, else a live unsaved preview computed via `settle.ts`'s greedy matching; response includes names, not just ids. Also returns a `stale` boolean — for a frozen plan, it recomputes the live plan and flags a mismatch so the UI can warn that expenses changed after finalizing |
| `POST /api/sessions/:sessionId/settlements` | ✅ | Finalizes (freezes) the current preview into persisted `Settlement` rows, each starting `paid: false`. Calling it again — "Recalculate" in the UI — replaces the plan with a fresh one computed from current expenses, resetting any paid progress |
| `PATCH /api/sessions/:sessionId/settlements/:settlementId` | ✅ | Toggles one frozen payment's `paid` flag; 404s if the settlement isn't part of this session |

All routes are mounted onto one `sessionsRouter` (an Express `Router`) in `sessions.ts`, attached in `index.ts` via `app.use("/api/sessions", sessionsRouter)`. They're kept in a single file rather than split per-resource because every route here is session-scoped — there's no independent top-level `/api/participants` or `/api/expenses`.

Route param is named `:sessionId` (not the generic `:id`) so it stays unambiguous once a route has multiple ids in scope (e.g. a future `paid_by` or `participantId`).

**Response serialization (fixed 2026-07-19):** every route above now shapes its response through a `serialize*` function (`serializeParticipant`, `serializeExpenseSplit`, `serializeExpense`, alongside the pre-existing `serializeSettlement`) instead of returning raw Prisma rows. Previously, `res.json(session)` etc. serialized whatever Prisma returned verbatim, leaking internal fields the frontend never reads: `sort_order`, `created_at`, `session_id`, and the raw `paid_by` id (superseded by the nested `payer` object). Confirmed against the frontend's own TypeScript interfaces before dropping anything.

Malformed `:sessionId` values (anything not shaped like a UUID) are rejected with a clean 404 by a `sessionsRouter.param("sessionId", ...)` gate, before any route handler or Prisma call runs — previously a non-UUID id reached Postgres as a raw "invalid input syntax" error and surfaced as a 500.

### Settlement algorithm (`backend/src/lib/settle.ts`)

A pure function, deliberately kept free of Prisma/database calls: `computeSettlements(balances)` takes a list of `{ participantId, balance }` (positive = owed money, negative = owes money) and returns the minimized list of `{ from_id, to_id, amount }` payments, via greedy debt simplification (sort creditors and debtors by size, repeatedly match the largest of each until both lists empty). The settlements routes do the I/O — fetching expenses, computing each participant's net balance via the `computeNetBalances` helper in `sessions.ts` — then hand the result to this function. Keeping the algorithm itself I/O-free makes it independently testable and easy to reason about — see `settle.test.ts` for 8 tests exercising it directly.

**Reconciliation tolerance (fixed 2026-07-19):** balances are compared to zero via `RECONCILED_EPSILON = 0.005` (half a centavo), exported from `settle.ts` and reused by the CUSTOM-split guard in `sessions.ts`. The original threshold was a full cent (`0.01`), reused from the "absorb floating-point noise" intent — but a full cent is *also* large enough to misclassify a genuine 1-centavo balance as already settled, silently dropping it from the plan. Concrete failure case the audit found: someone paid ₱0.02, split between two others at ₱0.01 each — both were filtered out as "settled," and the payer was never reimbursed. Half a centavo fixes this: still large enough to absorb real float noise (~1e-13 from repeated arithmetic on already-rounded amounts), small enough to never touch a genuine cent-scale balance. Both failure scenarios are now regression tests in `settle.test.ts`.

The CUSTOM split guard (in `sessions.ts`) was tightened the same day for the same reason: it used to accept splits off by up to a full cent from the expense total and store them as-is. It now rejects anything past half a centavo (reusing `RECONCILED_EPSILON`) rather than silently absorbing the difference — unlike EVEN/QUANTITY, where the *system* computes the per-person amounts and so owns the rounding, CUSTOM amounts are hand-entered by the user, so a real mismatch should come back as an error for them to fix, not a silent correction.

### Finalize / recalculate / mark-as-paid

The settlement plan starts as a **live preview** — recomputed on every `GET` from current expenses, never persisted. Hitting "Finalize" (`POST .../settlements`) freezes that preview into real `Settlement` rows so individual payments can be checked off (`PATCH`) as people actually pay each other back; this is what makes the progress bar on the settle screen meaningful instead of just a snapshot of the math.

Expenses stay editable at all times, even after finalizing — there's no lock. If something changes after the plan is frozen, "Recalculate" (the same `POST .../settlements` endpoint) replaces the frozen rows with a fresh plan, which resets every payment back to unpaid. We deliberately rejected a harder design (a `Session.finalized` flag that would block adding/deleting expenses until "unfinalized"): in a no-login, shared-link app, a session-wide lock toggled by one participant — that also wipes everyone else's paid progress as a side effect of fixing one missed expense — was worse UX than just trusting people to recalculate when needed.

**Stale-plan warning:** because expenses can change after finalizing, a frozen plan can silently drift from reality. `GET .../settlements` detects this by recomputing the live plan and comparing it to the frozen rows (the `settlementPlansMatch` helper in `sessions.ts`, matching on payer/payee/amount). When they differ, the response's `stale` flag is `true`, and both the settle screen and the read-only view show an amber banner — the settle screen prompts "Recalculate", the read-only view tells the participant to ask the organiser. This replaces the earlier failure mode where an out-of-date total (e.g. a plan finalized before the last expense was added) showed with no indication it was stale.

### Inspecting the database directly

- **Prisma Studio** — `cd backend && npx prisma studio` opens a browser GUI at `localhost:5555` showing every table, using the same `DATABASE_URL` as `prisma.config.ts`.
- **Raw SQL** — `podman exec -it divvy-app_db_1 psql -U divvy`, then `\dt` to list tables or `SELECT * FROM "Participant";` to query directly.

### Scripts (`backend/package.json`)

| Script              | Purpose                                      |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | Run the API with hot reload (`ts-node-dev`)   |
| `npm run build`      | Compile TypeScript to `dist/`                 |
| `npm start`          | Run the compiled server (production)          |
| `npm run prisma:migrate` | Create/apply a new migration              |
| `npm run prisma:generate` | Regenerate the Prisma Client after schema changes |
| `npm test`           | Run the Vitest suite once (`settle.ts` coverage)  |
| `npm run test:watch` | Run Vitest in watch mode                     |

## Frontend (`frontend/`)

Scaffolded via `create-next-app` (TypeScript, Tailwind, App Router, no `src/` dir, git init skipped since it lives inside this repo). Deleted the auto-generated `frontend/CLAUDE.md` (collided with the root one); kept `frontend/AGENTS.md`, which has a real warning worth knowing — this Next.js version (16.x) has breaking changes from older training-data assumptions, e.g. `params` in `page.tsx`/`layout.tsx` is now a `Promise` that must be `await`ed, not a plain object.

```
frontend/
├── app/
│   ├── layout.tsx                        # root layout + sticky navy "Divvy" header (wraps all pages)
│   ├── globals.css                       # Tailwind v4 @theme tokens + hand-written component classes (btn-primary, card, input, etc.)
│   ├── page.tsx                          # create-session form (name + dynamic participant list), POSTs to /api/sessions, redirects to /{sessionId}
│   ├── [sessionId]/page.tsx              # session view — add/delete expenses (3 split modes), inline payment-method entry, share + settle buttons
│   ├── [sessionId]/settle/page.tsx       # settle screen — preview/finalize/recalculate, mark-as-paid, progress bar, copy-to-pay
│   └── [sessionId]/view/page.tsx         # read-only participant view — expense breakdown + settlement plan, no edit controls
├── lib/
│   ├── recentSessions.ts                 # localStorage helper — remembers visited sessions on this device
│   ├── paymentDetails.ts                 # parseBankDetails()/formatBankDetails() — one shared home for the "Bank Name - Account Number" encoding
│   ├── apiUrl.ts                         # apiUrl(path) — builds an absolute backend URL from NEXT_PUBLIC_API_URL
│   └── fetcher.ts                        # shared SWR fetcher (generic error message parameterized per page)
└── .env.local                            # NEXT_PUBLIC_API_URL=http://localhost:4000 (NEXT_PUBLIC_ prefix required for any var read in browser-side code)
```

**Data fetching:** uses **SWR** (`useSWR`) for client-side GET (not `useEffect`+`useState`) — chosen to satisfy the `react-hooks/set-state-in-effect` lint rule, which discourages fetch-in-effect. `mutate()` refetches after mutations. Form defaults are derived at render (no `setState` in an effect). The fetcher itself and the `NEXT_PUBLIC_API_URL` base-URL lookup are shared helpers (fixed 2026-07-19, see Roadmap): `frontend/lib/fetcher.ts` (takes a per-page fallback error message as a parameter, since the pages' wording differed slightly) and `frontend/lib/apiUrl.ts` (`apiUrl(path)`), used by all four pages instead of three copy-pasted fetchers and ~12 hand-concatenated URLs.

**Add-expense form** has three split modes, all posting to `POST .../expenses`: **Evenly** (`EVEN`, participant checkboxes), **Quantity** (`QUANTITY`, total quantity → per-person units, backend computes amounts, "units remaining" guard), **Amount** (`CUSTOM`, per-person pesos, "remaining to split" guard). Amount/units inputs are `type="text"` (no number spinners) and clamp so totals can't exceed the expense.

Backend needed one change to support this: `cors` middleware added in `backend/src/index.ts`, since the frontend (`localhost:3000`) and backend (`localhost:4000`) are different origins and browsers block cross-origin `fetch()` by default. The middleware is restricted to an explicit origin allow-list (localhost for dev + the Vercel production origin) rather than a wildcard, so only the known frontends can call the API.

**Payment-method entry** is inline on the session view: tapping a participant's row in "Who's splitting" expands a small form. GCash and Maya show a single phone-number input. Bank Transfer shows two inputs (bank name + account number) which are combined on save into `"Bank Name - Account Number"` and stored in `payment_details`. On the settle screen, only the account number is copied to clipboard — the bank name is shown as the label (`BPI ·`) for context. `PATCH`es `.../participants/:participantId` on save. No identity gating — consistent with the rest of the app, anyone with the link can set anyone's payment method.

The `"Bank Name - Account Number"` split/join logic lives in one place, `frontend/lib/paymentDetails.ts` (`parseBankDetails`/`formatBankDetails`) — until 2026-07-19 it was hand-written with a magic `+3` (the separator's length) independently in the session-view edit form, the settle screen, and the read-only view, which is exactly the kind of duplication where one drifting copy would silently corrupt bank details.

**Payment display** on the settle screen reads each settlement row's creditor's payment method via a second `useSWR` call to `GET /api/sessions/:sessionId` (shares the SWR cache, often instant). GCash, Maya, and Bank Transfer all follow the same pattern: a label, the copyable detail, and a "Copy" button (Clipboard API). There are no GCash/Maya deep links — neither app exposes a public URL that pre-fills a peer transfer, so a "Pay via GCash" button would be misleading. The V2 plan is QR Ph codes, which GCash, Maya, and most banks all support natively; see CLAUDE.md's "Out of Scope for V1" section.

**Delete expense** — each expense card has a small `✕` button that confirms via `window.confirm`, fires `DELETE .../expenses/:expenseId`, and refetches. Errors surface in a red banner above the list.

**Shareable read-only link** — `[sessionId]/view/page.tsx` fetches the same two endpoints as the session + settle pages but renders everything as read-only: expense breakdown, settlement plan with payment-copy buttons, and a progress bar if the plan is frozen. No forms, no delete buttons, no finalize/recalculate controls. The session page has a "Share view link" button that copies `<origin>/<sessionId>/view` to clipboard.

**Design** — Tailwind v4, beige body background, sticky navy header with the "Divvy" wordmark. Component classes (`.btn-primary`, `.card`, `.input`, etc.) are defined in `globals.css` as plain CSS using `var(--color-*)` custom properties — not `@apply`. Reason: Next.js 15 with Turbopack does not run PostCSS plugins, so `@apply` is never processed and silently breaks the stylesheet. `@theme inline` (Tailwind v4 native) is used to define color tokens and generate utility classes; it works with Turbopack because it's part of Tailwind's native CSS engine, not a PostCSS step.

## Version control

Single root-level `.gitignore` (covers `node_modules/`, `dist/`, `.env`/`.env.*`, `.DS_Store` — applies repo-wide, not per-folder, since `backend/` and `frontend/` are both Node/TS and share the same ignore rules). Pushed to [github.com/ryansabandal/divvy-app](https://github.com/ryansabandal/divvy-app) (private). Always run `git status` before resuming rather than trusting any "uncommitted" notes in this file, since they go stale fast.

## Roadmap / next steps

V1 is feature-complete, deployed, and **formally closed** (2026-07-19) — the hardening pass below is done, and there's no single blocking item for next session.

### Hardening (complete — 2026-07-19)

Method: a full-repo audit ran **first**, via three parallel subagents split by *lens* — Correctness, Security, Best-Practice/Smells, each auditing the whole repo independently, consolidated into one severity-ranked report (see [CLAUDE.md](CLAUDE.md#engineering-principles) for why lens-split beats an area split like frontend/backend: it avoids "seam-blindness," a bug in the contract between two areas falling in the gap between two reviewers who each only look at one side). Findings were then triaged: bugs/correctness in scope for closing V1, smells/nice-to-haves backlogged. The security review came back clean on the big risk — cross-session IDOR is properly defended, every route scopes its lookup by `session_id` — plus no injection, no XSS, no committed secrets, and CORS already correctly restricted.

A real settlement-math bug surfaced during the audit (see below). Per the standing decision on money-as-`Float` (last section), it was **contained locally** with a tolerance fix rather than used as a reason to do the bigger integer-centavos refactor.

Fixed, in order:

1. **Unit tests for `settle.ts`** — added Vitest (`npm test` runs once, `npm run test:watch` for interactive dev — replacing the old placeholder script that just exited 1) and 8 tests in `settle.test.ts`: the plain cases (empty input, exact single match, everyone-already-settled, greedy-minimizes-transaction-count) plus two regression tests encoding the exact residual-cent bug below.
2. **Settlement residual-cent bug** — see the "Reconciliation tolerance" paragraph under Settlement algorithm above for the full explanation. Short version: a `0.01` threshold meant to absorb floating-point noise was also large enough to misclassify a genuine 1-centavo balance as "already settled," silently dropping it from the plan. Fixed by introducing `RECONCILED_EPSILON = 0.005` (half a centavo).
3. **CUSTOM-split guard tightened** — reused the same `RECONCILED_EPSILON` fix to reject hand-entered splits off by more than half a centavo, instead of silently accepting up to a full cent of drift (see the paragraph under Settlement algorithm for why CUSTOM rejects rather than auto-absorbs, unlike EVEN/QUANTITY).
4. **Duplicate participant IDs** — nothing rejected a repeated id inside `participant_ids` (EVEN) or a `splits` array (CUSTOM/QUANTITY), which double-charged that person and inflated the even-share denominator while the totals still "added up." Now rejected (a `Set` size check) in all three split branches, in `sessions.ts`.
5. **Malformed session ids returned 500, not 404** — a non-UUID `:sessionId` reached Postgres as a raw "invalid input syntax for type uuid" error before the route's own `if (!session) 404` check could ever run. Fixed with one `sessionsRouter.param("sessionId", ...)` gate that validates the format up front — for every route with that param, in one place, before any handler or Prisma call runs.
6. **Untrimmed participant name** — `POST .../participants` validated `name.trim()` for emptiness but then persisted the untrimmed `name`, so `"  Bob  "` kept its whitespace. Now stores `name.trim()`, matching how session creation already worked.
7. **Input size bounds** — the Zod schemas had `.min()` on arrays but no `.max()` anywhere, so one request (under Express's ~100KB body limit) could still nest an unbounded number of participants or splits. Added caps: 50 participants per session, 50 entries per `participant_ids`/`splits` array, 100-char name fields, 200-char descriptions.
8. **API response leaks** — see the "Response serialization" paragraph under API routes above. Five routes returned raw Prisma rows (`sort_order`, `created_at`, `session_id`, the raw `paid_by` id all leaked into JSON); now every route serializes through `serializeParticipant`/`serializeExpenseSplit`/`serializeExpense`, matching the pattern `serializeSettlement` already established.
9. **Frontend duplication** — see the "Data fetching" paragraph under Frontend above. Extracted `frontend/lib/fetcher.ts` and `frontend/lib/apiUrl.ts`, replacing three copy-pasted `fetcher` definitions and ~12 hand-concatenated `NEXT_PUBLIC_API_URL` call sites across all four pages.
10. **Bank-details parsing duplicated 3×** — see the paragraph under "Payment-method entry" above. Extracted to `frontend/lib/paymentDetails.ts`.

Verified, not just written: backend `tsc --noEmit` clean, all 8 Vitest tests passing, frontend `tsc --noEmit` clean, and a full `next build` succeeded across all four routes.

**Backlogged from the same audit** — lower-priority; filed as individual tickets under `.scratch/v1-hardening-audit/issues/01` through `12` (per the local-markdown issue tracker convention — see `docs/agents/issue-tracker.md`), not fixed today: no rate limiting on any endpoint, error disclosure that depends on `NODE_ENV` being set, no shared frontend types module (interfaces duplicated byte-for-byte across pages), the settlement-screen payment-action UI duplicated between the settle and view pages, repeated money-rounding logic with no named util, inconsistent request validation (Zod in some routes, hand-rolled `typeof` checks in others — notably the two participant routes untouched by fix #7 above), near-identical `handleFinalize`/`handleRecalculate` handlers, CORS origins hardcoded in source instead of an env var, the non-idiomatic `React.SubmitEvent` type (should be `FormEvent`), one stale comment that undersold a 3-way branch as 2-way, a settlement progress bar with no ARIA semantics, and `noUncheckedIndexedAccess` left off in both tsconfigs.

**Pre-existing, unrelated to this pass:** `npm audit` flags 3 moderate-severity vulnerabilities in Prisma's own dev tooling (`@hono/node-server`, via `@prisma/dev`) — fixing them requires a Prisma downgrade, so this was left alone and is just noted here for awareness.

### V2 (explicitly deferred, not in V1 scope)

All three need file-storage infrastructure this stack doesn't have yet — solve that once for all rather than building upload infra piecemeal:

- **QR Ph code upload** for payment methods — the intended end-state for GCash/Maya/bank payments (payer scans instead of copying a number)
- **Receipt photo OCR** — auto-parse an itemised bill instead of manual entry
- **Proof-of-payment screenshot upload** — let participants validate a payment was made

### Considered but intentionally not scheduled

- **Money as integer centavos** — amounts are stored as `Float`, so rounding logic is scattered. Switching to integer centavos (or `Decimal`) would remove a class of rounding bugs, but the current per-cent-remainder reconciliation is working, so this is noted, not planned. Re-confirmed during the 2026-07-19 audit: a real rounding bug *was* found (see Hardening above), and the deliberate decision was to contain it with a tolerance fix rather than treat it as the trigger for this larger refactor.
