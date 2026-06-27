# Divvy — Architecture (current state)

A simple bill-splitting app for friend groups. See [CLAUDE.md](CLAUDE.md) for full product scope. This README documents what's actually built so far and how the pieces fit together.

## Status

| Layer                       | Status                                                  |
| ---------------------------- | --------------------------------------------------------- |
| Local Postgres (Podman)      | ✅ Running via `compose.yml`                              |
| Prisma schema                | ✅ Defined, migrated                                      |
| Express API                  | ✅ `/health`, sessions, participants — expenses next      |
| Settlement algorithm         | ⬜ Not started                                            |
| Frontend (Next.js)           | ⬜ Not started                                            |
| Railway deployment           | ⬜ Not started                                            |
| Git / GitHub                 | 🟡 Local repo initialized (`git init`), not yet committed or pushed |

## High-level flow

```
Browser
   │
   ▼
Next.js frontend (not yet built)
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
│   └── routes/
│       └── sessions.ts        # all /api/sessions/* routes (session-scoped: participants, expenses, settlements)
├── .env                       # DATABASE_URL + PORT for local dev (not committed)
├── tsconfig.json
└── package.json
```

### Why two separate places configure the database connection

Prisma 7 removed the `url` field from `schema.prisma` itself. Connection strings now live in two places, for two different consumers:

- **`prisma.config.ts`** — used by the Prisma **CLI** (`prisma migrate dev`, `prisma studio`). Reads `DATABASE_URL` from `.env` directly.
- **`src/db.ts`** — used by the **running application**. Wraps a `pg` connection pool in a `PrismaPg` "driver adapter" and hands it to `PrismaClient`. This is Prisma 7's new no-Rust-engine mode — queries go straight through the `pg` driver instead of a bundled Rust binary.

Both ultimately point at the same `DATABASE_URL`, but the CLI and the app each need their own explicit wiring since the schema file no longer carries the connection itself.

### Data model

Defined in `backend/prisma/schema.prisma`, mirrors the model in CLAUDE.md:

- **Session** — a bill-splitting group; has many participants, expenses, settlements.
- **Participant** — a person in a session; can pay for expenses, owe splits, owe/be owed settlements.
- **Expense** — one logged cost, paid by one participant, split `EVEN` or `CUSTOM`.
- **ExpenseSplit** — per-participant share of one expense.
- **Settlement** — a computed, simplified payment from one participant to another (output of the debt-simplification algorithm, not yet implemented).

### API routes (`backend/src/routes/sessions.ts`)

| Route | Status | Notes |
| --- | --- | --- |
| `POST /api/sessions` | ✅ | Creates a `Session` and all initial `Participant` rows in one Prisma nested write |
| `GET /api/sessions/:sessionId` | ✅ | Returns the session with `participants` and `expenses` (with `payer` + `splits`) included |
| `POST /api/sessions/:sessionId/participants` | ✅ | Adds one participant to an existing session; 404s if the session doesn't exist |
| `POST /api/sessions/:sessionId/expenses` | ⬜ | Not yet built |
| `GET /api/sessions/:sessionId/settlements` | ⬜ | Not yet built — depends on `settle.ts` |

All routes are mounted onto one `sessionsRouter` (an Express `Router`) in `sessions.ts`, attached in `index.ts` via `app.use("/api/sessions", sessionsRouter)`. They're kept in a single file rather than split per-resource because every route here is session-scoped — there's no independent top-level `/api/participants` or `/api/expenses`.

Route param is named `:sessionId` (not the generic `:id`) so it stays unambiguous once a route has multiple ids in scope (e.g. a future `paid_by` or `participantId`).

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

Not yet scaffolded. Per the build order in CLAUDE.md, this comes after the API routes and settlement algorithm.

## Version control

Single root-level `.gitignore` (covers `node_modules/`, `dist/`, `.env`/`.env.*`, `.DS_Store` — applies repo-wide, not per-folder, since `backend/` and the future `frontend/` are both Node/TS and share the same ignore rules). Local repo initialized on `main`. GitHub repo (`divvy-app`, private) to be created via `gh repo create` once the first commit is made.

## Not yet built

- `POST /api/sessions/:sessionId/expenses` and `GET /api/sessions/:sessionId/settlements`
- `backend/src/lib/settle.ts` — greedy debt-simplification algorithm
- Next.js frontend (session creation, expense entry, settlement screen)
- GCash/Maya payment link generation
- Railway deployment (Postgres + Express) and Vercel deployment (Next.js)
