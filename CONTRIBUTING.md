# Contributing to Divvy

This is the from-zero guide to getting Divvy running locally and the conventions
used in the repo. For *what* the app is, see [CLAUDE.md](CLAUDE.md) (the spec);
for *how the pieces fit together*, see [README.md](README.md) (the architecture).
This file is deliberately just setup + workflow — it does not re-explain either.

## Prerequisites

- **Node.js** (v20+) and npm
- **Podman** + **podman-compose** (the container runtime this project standardizes on — rootless/daemonless, not Docker)

## First-time setup (clone → running app)

```bash
# 1. Install dependencies (two separate Node projects)
cd backend  && npm install
cd ../frontend && npm install

# 2. Create the two env files (both are gitignored — see "Environment variables" below)
#    backend/.env  and  frontend/.env.local

# 3. Start Postgres in a container
podman-compose up -d            # from the repo root, where compose.yml lives

# 4. Apply the database schema
cd backend && npm run prisma:migrate    # creates/applies migrations
npm run prisma:generate                 # regenerate the client (see note below)

# 5. Run the two dev servers in separate terminals
cd backend  && npm run dev      # Express API on http://localhost:4000
cd frontend && npm run dev      # Next.js on  http://localhost:3000
```

Open http://localhost:3000.

> **Note:** `prisma migrate dev` does not always regenerate the Prisma Client, so
> run `npm run prisma:generate` after every migration. If the dev server seems to
> serve old code after an edit, see the "stale code" section in the README.

## Environment variables

Neither env file is committed (both are in `.gitignore`), so a fresh clone has to
recreate them. Copy these templates:

**`backend/.env`**
```
DATABASE_URL="postgresql://divvy:divvy@localhost:5432/divvy"
PORT=4000
```
The credentials match the `db` service in [compose.yml](compose.yml).

**`frontend/.env.local`**
```
NEXT_PUBLIC_API_URL=http://localhost:4000
```
The `NEXT_PUBLIC_` prefix is required for any variable read in browser-side code.

## Common tasks

| Task | Command (from `backend/`) |
| --- | --- |
| New migration after editing `schema.prisma` | `npm run prisma:migrate` then `npm run prisma:generate` |
| Inspect the DB in a browser GUI | `npx prisma studio` (http://localhost:5555) |
| Inspect the DB via raw SQL | `podman exec -it divvy-app_db_1 psql -U divvy` |
| Compile the API for production | `npm run build` → `npm start` |
| Stop Postgres (keeps data) | `podman-compose down` (add `-v` to wipe the volume) |

## Git conventions

- **Branch off `main`** for any change; `main` is the default/PR branch.
- **Commit messages**: short imperative subject describing the user-facing change
  (matches the existing history, e.g. *"Added settlement capability and payment
  method options"*).
- Run `git status` before resuming work — the README's "what's uncommitted" notes
  go stale quickly, so trust the working tree, not the doc.

## Code conventions

- **TypeScript throughout**, `strict` on in both projects.
- **Comment non-trivial blocks**: every non-obvious line or block gets a one-line
  comment explaining *what it does and why*, so a first-time reader can follow it.
- **Validate at the API boundary**: request handlers should reject bad input before
  it reaches Prisma, rather than trusting TypeScript annotations on `req.body`.
- **Keep the settlement algorithm I/O-free**: `backend/src/lib/settle.ts` is a pure
  function (no Prisma/DB) so it stays unit-testable; do the I/O in the route.
