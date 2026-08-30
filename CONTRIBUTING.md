# Contributing to Divvy

This is the from-zero guide to getting Divvy running locally and the conventions
used in the repo. For *what* the app is, see [CLAUDE.md](CLAUDE.md) (the spec);
for *how the pieces fit together*, see [README.md](README.md) (the architecture).
This file is deliberately just setup + workflow — it does not re-explain either.

## Prerequisites

- **Node.js** (v20+) and npm
- **Podman** + **podman-compose** (the container runtime this project standardizes on — rootless/daemonless, not Docker) — only needed for local Postgres; the app itself is a single Next.js project with no other services

## Local Postgres

`compose.yml` defines one service — **`db`** (`postgres:16`, exposed on `localhost:5432`, with a named volume `divvy_db` so data survives restarts). It's the only containerized piece; the app itself runs directly on the host via `npm run dev`.

```
podman-compose up -d     # start Postgres
podman-compose down      # stop (keeps data — add -v to wipe the volume)
```

## First-time setup (clone → running app)

```bash
# 1. Install dependencies
npm install

# 2. Create the env file (gitignored — see "Environment variables" below)
#    .env

# 3. Start Postgres in a container
podman-compose up -d            # from the repo root, where compose.yml lives

# 4. Apply the database schema
npm run prisma:migrate          # creates/applies migrations
npm run prisma:generate         # regenerate the client (see note below)

# 5. Run the dev server
npm run dev                     # Next.js on http://localhost:3000
```

Open http://localhost:3000.

> **Note:** `prisma migrate dev` does not always regenerate the Prisma Client, so
> run `npm run prisma:generate` after every migration.

## Environment variables

`.env` is gitignored, so a fresh clone has to recreate it. Copy the template:

**`.env`** (see [.env.example](.env.example))
```
DATABASE_URL="postgresql://divvy:divvy@localhost:5432/divvy"
```
The credentials match the `db` service in [compose.yml](compose.yml).

Production (Vercel) does **not** use this file — `DATABASE_URL` is set directly in
the Vercel dashboard per environment, pointed at Supabase's **pooled** (6543,
`?pgbouncer=true`) connection string. If you ever need to run a migration against
production yourself, use Supabase's **direct** (5432) string instead, on the
command line only (`DATABASE_URL="<direct-5432-string>" npx prisma migrate
deploy`) — never put it in a file, and never point the Vercel build at it; the
pooled string is the only one the running app should ever use.

## Common tasks

| Task | Command |
| --- | --- |
| Run the app with hot reload (Turbopack) | `npm run dev` |
| Compile for production (`prisma generate` then `next build` — re-run here since Vercel caches `node_modules`) | `npm run build` |
| Run the production build | `npm start` |
| Lint | `npm run lint` |
| New migration after editing `schema.prisma` (local Podman Postgres) | `npm run prisma:migrate` then `npm run prisma:generate` |
| Apply existing migrations without prompting — for production, run by hand against Supabase's **direct** (5432) connection string, never in the Vercel build | `npm run prisma:deploy` |
| Regenerate the Prisma Client after schema changes (also runs automatically via `postinstall`) | `npm run prisma:generate` |
| Inspect the DB in a browser GUI | `npx prisma studio` (http://localhost:5555) |
| Inspect the DB via raw SQL | `podman exec -it divvy-app_db_1 psql -U divvy` |
| Run unit tests once (`lib/settle.test.ts`) | `npm test` |
| Run the unit suite in watch mode | `npm run test:watch` |
| Run the HTTP integration suite (needs `npm run dev` running) | `npm run test:integration` |
| Stop Postgres (keeps data) | `podman-compose down` (add `-v` to wipe the volume) |

## Git conventions

- **Branch off `main`** for any change; `main` is the default/PR branch.
- **Commit messages**: short imperative subject describing the user-facing change
  (matches the existing history, e.g. *"Added settlement capability and payment
  method options"*).
- **Single root-level `.gitignore`** — covers `node_modules/`, `dist/`, `.env`/`.env.*`,
  `.DS_Store`; the whole repo is one Node/TS project.
- **Remote** — [github.com/ryansabandal/divvy-app](https://github.com/ryansabandal/divvy-app)
  (private).
- Run `git status` before resuming work — don't trust stale "uncommitted work" notes
  in any doc, this one included; the working tree is the source of truth.

## Code conventions

- **TypeScript throughout**, `strict` on.
- **Comment non-trivial blocks**: every non-obvious line or block gets a one-line
  comment explaining *what it does*, so a first-time reader can follow it. Keep
  rationale, history, and ticket numbers out of the code — those belong in the
  ticket file or CHANGELOG.md, which is where a reader can act on them.
- **Validate at the API boundary**: Route Handlers should reject bad input via Zod
  before it reaches Prisma, rather than trusting TypeScript annotations alone.
- **Keep the settlement algorithm I/O-free**: `lib/settle.ts` is a pure function
  (no Prisma/DB) so it stays unit-testable; do the I/O in the route.
