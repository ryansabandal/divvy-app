# Divvy — Architecture (current state)

A simple bill-splitting app for friend groups. See [CLAUDE.md](CLAUDE.md) for full product scope. This README documents what's actually built so far and how the pieces fit together.

## Status

| Layer                       | Status                                                  |
| ---------------------------- | --------------------------------------------------------- |
| Local Postgres (Podman)      | ✅ Running via `compose.yml`                              |
| Prisma schema                | ✅ Sessions, participants (+ payment method), expenses, splits, settlements |
| Express API                  | ✅ All V1 routes built — see table below                  |
| Settlement algorithm         | ✅ `backend/src/lib/settle.ts`, greedy debt simplification |
| Frontend (Next.js)           | ✅ All V1 features built — create-session, session view (add/delete expenses: EVEN/QUANTITY/CUSTOM, per-person breakdown, inline payment-method entry), settle screen (finalize/recalculate/mark-as-paid/copy-to-pay), shareable read-only link (`/view`), design pass (navy/teal/sky-blue/beige/white); deployment pending |
| Railway deployment           | ⬜ Not started                                            |
| Git / GitHub                 | ✅ Pushed to [github.com/ryansabandal/divvy-app](https://github.com/ryansabandal/divvy-app) (private) |

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
│       └── settle.ts          # pure function: net balances in, minimized payment list out — no Prisma/DB calls
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
| `GET /api/sessions/:sessionId/settlements` | ✅ | Returns the frozen plan (with `paid` flags) if one exists, else a live unsaved preview computed via `settle.ts`'s greedy matching; response includes names, not just ids |
| `POST /api/sessions/:sessionId/settlements` | ✅ | Finalizes (freezes) the current preview into persisted `Settlement` rows, each starting `paid: false`. Calling it again — "Recalculate" in the UI — replaces the plan with a fresh one computed from current expenses, resetting any paid progress |
| `PATCH /api/sessions/:sessionId/settlements/:settlementId` | ✅ | Toggles one frozen payment's `paid` flag; 404s if the settlement isn't part of this session |

All routes are mounted onto one `sessionsRouter` (an Express `Router`) in `sessions.ts`, attached in `index.ts` via `app.use("/api/sessions", sessionsRouter)`. They're kept in a single file rather than split per-resource because every route here is session-scoped — there's no independent top-level `/api/participants` or `/api/expenses`.

Route param is named `:sessionId` (not the generic `:id`) so it stays unambiguous once a route has multiple ids in scope (e.g. a future `paid_by` or `participantId`).

### Settlement algorithm (`backend/src/lib/settle.ts`)

A pure function, deliberately kept free of Prisma/database calls: `computeSettlements(balances)` takes a list of `{ participantId, balance }` (positive = owed money, negative = owes money) and returns the minimized list of `{ from_id, to_id, amount }` payments, via greedy debt simplification (sort creditors and debtors by size, repeatedly match the largest of each until both lists empty). The settlements routes do the I/O — fetching expenses, computing each participant's net balance via the `computeNetBalances` helper in `sessions.ts` — then hand the result to this function. Keeping the algorithm itself I/O-free makes it independently testable and easy to reason about.

### Finalize / recalculate / mark-as-paid

The settlement plan starts as a **live preview** — recomputed on every `GET` from current expenses, never persisted. Hitting "Finalize" (`POST .../settlements`) freezes that preview into real `Settlement` rows so individual payments can be checked off (`PATCH`) as people actually pay each other back; this is what makes the progress bar on the settle screen meaningful instead of just a snapshot of the math.

Expenses stay editable at all times, even after finalizing — there's no lock. If something changes after the plan is frozen, "Recalculate" (the same `POST .../settlements` endpoint) replaces the frozen rows with a fresh plan, which resets every payment back to unpaid. We deliberately rejected a harder design (a `Session.finalized` flag that would block adding/deleting expenses until "unfinalized"): in a no-login, shared-link app, a session-wide lock toggled by one participant — that also wipes everyone else's paid progress as a side effect of fixing one missed expense — was worse UX than just trusting people to recalculate when needed.

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
└── .env.local                            # NEXT_PUBLIC_API_URL=http://localhost:4000 (NEXT_PUBLIC_ prefix required for any var read in browser-side code)
```

**Data fetching:** uses **SWR** (`useSWR`) for client-side GET (not `useEffect`+`useState`) — chosen to satisfy the `react-hooks/set-state-in-effect` lint rule, which discourages fetch-in-effect. `mutate()` refetches after mutations. Form defaults are derived at render (no `setState` in an effect).

**Add-expense form** has three split modes, all posting to `POST .../expenses`: **Evenly** (`EVEN`, participant checkboxes), **Quantity** (`QUANTITY`, total quantity → per-person units, backend computes amounts, "units remaining" guard), **Amount** (`CUSTOM`, per-person pesos, "remaining to split" guard). Amount/units inputs are `type="text"` (no number spinners) and clamp so totals can't exceed the expense.

Backend needed one change to support this: `cors` middleware added in `backend/src/index.ts`, since the frontend (`localhost:3000`) and backend (`localhost:4000`) are different origins and browsers block cross-origin `fetch()` by default.

**Payment-method entry** is inline on the session view: tapping a participant's row in "Who's splitting" expands a small form. GCash and Maya show a single phone-number input. Bank Transfer shows two inputs (bank name + account number) which are combined on save into `"Bank Name - Account Number"` and stored in `payment_details`. On the settle screen, only the account number is copied to clipboard — the bank name is shown as the label (`BPI ·`) for context. `PATCH`es `.../participants/:participantId` on save. No identity gating — consistent with the rest of the app, anyone with the link can set anyone's payment method.

**Payment display** on the settle screen reads each settlement row's creditor's payment method via a second `useSWR` call to `GET /api/sessions/:sessionId` (shares the SWR cache, often instant). GCash, Maya, and Bank Transfer all follow the same pattern: a label, the copyable detail, and a "Copy" button (Clipboard API). There are no GCash/Maya deep links — neither app exposes a public URL that pre-fills a peer transfer, so a "Pay via GCash" button would be misleading. The V2 plan is QR Ph codes, which GCash, Maya, and most banks all support natively; see CLAUDE.md's "Out of Scope for V1" section.

**Delete expense** — each expense card has a small `✕` button that confirms via `window.confirm`, fires `DELETE .../expenses/:expenseId`, and refetches. Errors surface in a red banner above the list.

**Shareable read-only link** — `[sessionId]/view/page.tsx` fetches the same two endpoints as the session + settle pages but renders everything as read-only: expense breakdown, settlement plan with payment-copy buttons, and a progress bar if the plan is frozen. No forms, no delete buttons, no finalize/recalculate controls. The session page has a "Share view link" button that copies `<origin>/<sessionId>/view` to clipboard.

**Design** — Tailwind v4, beige body background, sticky navy header with the "Divvy" wordmark. Component classes (`.btn-primary`, `.card`, `.input`, etc.) are defined in `globals.css` as plain CSS using `var(--color-*)` custom properties — not `@apply`. Reason: Next.js 15 with Turbopack does not run PostCSS plugins, so `@apply` is never processed and silently breaks the stylesheet. `@theme inline` (Tailwind v4 native) is used to define color tokens and generate utility classes; it works with Turbopack because it's part of Tailwind's native CSS engine, not a PostCSS step.

## Version control

Single root-level `.gitignore` (covers `node_modules/`, `dist/`, `.env`/`.env.*`, `.DS_Store` — applies repo-wide, not per-folder, since `backend/` and `frontend/` are both Node/TS and share the same ignore rules). Pushed to [github.com/ryansabandal/divvy-app](https://github.com/ryansabandal/divvy-app) (private). Always run `git status` before resuming rather than trusting any "uncommitted" notes in this file, since they go stale fast.

## Not yet built

- Railway deployment (Postgres + Express) and Vercel deployment (Next.js) — the last remaining V1 item
- V2 (explicitly deferred, not in V1 scope): QR Ph code upload for payment methods (the intended end-state for GCash/Maya/bank payments — payer scans instead of copying), receipt photo OCR, proof-of-payment screenshot upload — all three need file storage infrastructure this stack doesn't have yet; solve once for all rather than building upload infra piecemeal
