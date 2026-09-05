# Divvy — Bill Splitting App

## Project Overview

A simple web app for friend groups to split casual expenses. Core design principle: simpler and less cluttered than Splitwise. No login required — one person creates a session, adds participants, and shares the link.

This file is the spec (what to build). See [README.md](README.md) for current build status, what's actually implemented, and architecture notes.

## Stack

- **Framework:** Next.js (React) — App Router, Route Handlers for the API — deployed on Vercel
- **Database:** PostgreSQL — hosted on Supabase
- **ORM:** Prisma (driver-adapter mode via `@prisma/adapter-pg`)
- **Language:** TypeScript throughout

A single Next.js app; there is no separate backend service. Route Handlers under `app/api/**` are the API — see [README.md](README.md) for why (the July 2026 serverless migration off Railway/Express).

## Project Structure

```
divvy-app/
├── app/
│   ├── page.tsx                              # Create session + "Your recent sessions" list
│   ├── [sessionId]/page.tsx                  # Session view (edit)
│   ├── [sessionId]/settle/page.tsx           # Settlement screen
│   ├── [sessionId]/view/page.tsx             # Read-only participant view
│   └── api/
│       ├── health/route.ts                   # GET — used by the Supabase keepalive cron
│       └── sessions/                         # All session-scoped routes; no independent top-level routes
│           ├── route.ts                      # POST /api/sessions
│           └── [sessionId]/
│               ├── route.ts                  # GET /api/sessions/:sessionId
│               ├── participants/[...]        # POST, PATCH :participantId, /:participantId/qr (POST/PUT/DELETE — QR upload)
│               ├── expenses/[...]            # POST, PATCH (single + bulk reorder), DELETE
│               └── settlements/[...]         # GET, POST, PATCH :settlementId
├── lib/
│   ├── db.ts                                 # Shared Prisma client (globalThis singleton guard for dev HMR)
│   ├── recentSessions.ts                     # localStorage helper — remembers visited sessions on this device
│   ├── paymentDetails.ts                     # parseBankDetails()/formatBankDetails() — one shared home for the "Bank Name - Account Number" encoding
│   ├── fetcher.ts                            # shared SWR fetcher (generic error message parameterized per page)
│   ├── expenseBreakdown.ts                   # buildParticipantBreakdown() — what one person is charged for; pure, no React
│   ├── expenseSession.ts                     # loadSessionParticipants()/validatePayer() — shared session-fetch + payer-membership check for expense routes
│   ├── expenseSplits.ts                      # split-building logic for EVEN/CUSTOM/QUANTITY
│   ├── money.ts                              # distributeCents() — apportions a centavo total across weighted shares
│   ├── money.test.ts                         # Vitest unit tests for the apportionment, incl. a no-negative/exact-sum sweep
│   ├── requestBody.ts                        # parseBody()/parseJsonBody() — shared parse-then-validate-then-400 pipeline for every mutating route
│   ├── serialize.ts                          # DB row → API response shaping
│   ├── settlementHelpers.ts                  # shared settlement-plan helpers
│   ├── settle.ts                             # Debt simplification algorithm
│   ├── settle.test.ts                        # Vitest unit tests, incl. regression coverage for the residual-cent fix
│   ├── validation.ts                         # requireValidSessionId() and friends
│   ├── imageCompress.ts                      # client-side <canvas> compression to JPEG before a QR upload
│   ├── storage.ts                            # Supabase Storage service-role client — signed QR upload URLs, best-effort delete
│   └── storageUrl.ts                         # publicObjectUrl() — deterministic public Storage URL from an object path
├── components/
│   ├── ExpenseBreakdown.tsx                  # collapsible per-person charge list, shared by the settle + view pages
│   ├── PaymentAction.tsx                     # payment-method label/display/copy, shared by the settle + view pages
│   ├── SessionSummary.tsx                    # bento-tile totals (bill, people, avg/person), shared by the session/settle/view pages
│   ├── SettlementProgress.tsx                # progress bar (incl. ARIA), shared by the settle + view pages
│   └── StalePlanBanner.tsx                   # "expenses changed since finalizing" warning, shared by the settle + view pages
├── schemas/
│   └── sessions.ts                           # Zod schemas for every request body
├── prisma/
│   └── schema.prisma
├── prisma.config.ts                          # DB connection for the Prisma CLI
└── tests/
    └── sessions.integration.test.ts          # HTTP-level parity suite against a running dev server (TEST_BASE_URL)
```

## Data Model

```prisma
model Session {
  id           String        @id @default(uuid())
  name         String
  created_at   DateTime      @default(now())
  participants Participant[]
  expenses     Expense[]
  settlements  Settlement[]
}

model Participant {
  id                  String              @id @default(uuid())
  session_id          String
  name                String
  payment_method_type PaymentMethodType?
  payment_details     String?             // phone number for GCASH/MAYA, "Bank Name - Account Number" for BANK_TRANSFER
  created_at          DateTime            @default(now())
  sort_order          Int                 @default(autoincrement()) // keeps participant lists in a stable order; see README for why this can't just be created_at
  session             Session             @relation(fields: [session_id], references: [id])
  expenses            Expense[]
  splits              ExpenseSplit[]
  owes                Settlement[]        @relation("Debtor")
  owed                Settlement[]        @relation("Creditor")
}

model Expense {
  id          String         @id @default(uuid())
  session_id  String
  paid_by     String
  amount      Float
  description String
  split_type  SplitType
  quantity    Int?           // total units for a QUANTITY split (e.g. 6 shots); null otherwise
  sort_order  Int            @default(autoincrement()) // keeps the expense list in a stable order and survives drag-and-drop reordering
  session     Session        @relation(fields: [session_id], references: [id])
  payer       Participant    @relation(fields: [paid_by], references: [id])
  splits      ExpenseSplit[]
}

model ExpenseSplit {
  id             String      @id @default(uuid())
  expense_id     String
  participant_id String
  amount_owed    Float
  units          Int?        // units this participant consumed in a QUANTITY split; null otherwise
  expense        Expense     @relation(fields: [expense_id], references: [id], onDelete: Cascade)
  participant    Participant @relation(fields: [participant_id], references: [id])
}

model Settlement {
  id          String      @id @default(uuid())
  session_id  String
  from_id     String
  to_id       String
  amount      Float
  paid        Boolean     @default(false) // whether this payment has actually been made
  session     Session     @relation(fields: [session_id], references: [id])
  debtor      Participant @relation("Debtor", fields: [from_id], references: [id])
  creditor    Participant @relation("Creditor", fields: [to_id], references: [id])
}

enum SplitType {
  EVEN
  CUSTOM
  QUANTITY
}

enum PaymentMethodType {
  GCASH
  MAYA
  BANK_TRANSFER
}
```

## V1 Features (Strict Scope)

> **Status:** V1 is **feature-complete, deployed, and formally closed** (hardening pass completed 2026-07-19 — a full-repo audit plus every fix it produced). **Current priority and next steps always live in [CHANGELOG.md](CHANGELOG.md), not here** — this file is the spec and goes stale fast if status is duplicated into it.
>
> **Post-close additions (2026-07-19):** edit-in-place + drag-and-drop reorder for expenses, and per-person charge breakdown (both below) — neither needed file-storage infra, so unlike the V2 trio they weren't held for that gate; added as direct quality improvements on an already-closed V1.

- [x] Create a session (name the bill, add participants)
- [x] Add expenses (who paid, how much, description)
- [x] Even split or custom amounts per participant
- [x] Edit an expense in place (no more delete-and-recreate to fix a mistake) and drag-and-drop reorder the expense list
- [x] Delete an expense (fix mistakes/duplicates)
- [x] Participant self-enters their payment method via the shared link — GCash/Maya phone number, or bank name + account number entered as separate fields (stored combined as `"Bank Name - Account Number"`; only the account number is copied on the settle screen)
- [x] Settlement screen — who owes who (minimized transactions), with mark-as-paid tracking against a finalized plan
- [x] Per-person charge breakdown on the settle + read-only view screens — expand a settlement row to see exactly which expenses the debtor is being charged for, so they can verify their own line items without scrolling the full expense list. Deliberately describes the **person**, not the payment: the plan is a simplified routing of net balances, so a given row often can't be traced to specific line items (the debtor and creditor may never have shared an expense)
- [x] Display each participant's GCash/Maya number or bank account on the settle screen with a copy button so the payer can initiate the transfer themselves inside the relevant app
- [x] Shareable read-only session link (`/[sessionId]/view`) — expense breakdown + settlement plan, no edit controls; "Share view link" button on the session page copies the URL to clipboard
- [x] Return to a past session without login — home page shows a device-local "Your recent sessions" list (`lib/recentSessions.ts`, backed by `localStorage`, newest-first, capped at 10); "Copy session link" button on the session page for cross-device return (chosen over a raw sessionId copy/paste flow — a 36-char UUID is error-prone to hand-copy and the app already has a better container for it: the URL)
- [x] Design pass — forest/sage/cream/warm-cream palette (refreshed 2026-08-15 from the original navy/teal/sky-blue/beige/white — token *names* unchanged, only values; see CHANGELOG.md), Instrument Serif for user-supplied titles, bento-tile summary; sticky header with Divvy wordmark; Tailwind v4 with plain CSS component classes (no `@apply` — Turbopack bypasses PostCSS, so `@apply` is never processed)

## Out of Scope for V1

- User authentication
- Recurring bills
- Push notifications
- Expense history across sessions
- Multi-currency
- Receipt photo upload + auto-parsing (OCR) — deferred to V2, not started
- Proof-of-payment screenshot upload (for other participants to validate a payment) — deferred to V2 alongside OCR, not started; same file-storage infrastructure QR Ph upload already uses (see below)
- Settlement status indicator (checkmark/"Done" on a session in the recent-sessions list once its plan is finalized and fully paid) — idea only, not scheduled; the `Settlement.paid` data already exists, but the recent-sessions list is device-local (`localStorage`), so this needs a batch status endpoint rather than one request per listed session

## QR Ph Code Upload — Shipped (added 2026-08-16, post-V1-close)

The first of the deferred V2 trio (QR Ph upload, receipt OCR, proof-of-payment screenshots) to actually ship, once Supabase Storage groundwork existed for it. Receipt OCR and proof-of-payment screenshots are still not started — see "Out of Scope for V1" above.

- Participant uploads a QR code (GCash's, Maya's, or any bank app's — not required to be QR Ph-badged) via a fourth "QR" tab alongside GCash/Maya/Bank Transfer in the payment-method editor on the session page.
- **One shared slot**, not one per payment method (`Participant.qr_object_path`) — a GCash-generated QR scans fine in a bank app, consistent with QR Ph's interoperability. **Supplements, never replaces** the phone-number/account-number fields: a participant can have either, both, or neither, and the settle/view screens render whichever is present.
- Client-side compression (`lib/imageCompress.ts`) before upload — canvas-drawn, capped at 1600px on the longest edge, re-exported as JPEG at 0.85 quality, with a white background fill first (a transparent QR would otherwise composite onto a black backdrop and become unscannable). This same canvas re-export incidentally produces a JPEG from HEIC input too, but only where the browser's own `<img>` can decode HEIC (most current iOS Safari versions can) — no dedicated HEIC-conversion dependency was added on a verify-first basis; if a browser hands over an undecodable HEIC file, the upload fails with a clear error instead of silently breaking.
- Upload flow: `POST .../participants/:participantId/qr` mints a signed Supabase Storage upload URL, the browser PUTs the compressed image straight to Storage, then `PUT .../participants/:participantId/qr` persists the object path (best-effort deleting the replaced object, if any). `DELETE` clears it.
- Displayed on the settle + read-only view screens via `components/PaymentAction.tsx`, tap-to-enlarge full-screen — a settle-row thumbnail is too small to actually scan.
- This shipped implementation is a real-world instance of the "V2 File Uploads — Locked Constraints" below, not an exception to them — confirmed by reading `lib/storage.ts` and the `qr` route: signed direct-upload URLs, a server-side Prisma gatekeeper (no Supabase Auth), and public-read storage scoped by session folder.
- Known open hardening items (a `capture="environment"` UX bug, a couple of security-hardening tickets) live under `.scratch/v2-qr-ph-upload/issues/` — current status in [CHANGELOG.md](CHANGELOG.md).

## V2 File Uploads — Locked Constraints

All three V2 file-upload features (QR Ph upload, receipt OCR, proof-of-payment screenshots) needed file storage — solve that once for all rather than piecemeal. QR Ph upload has since shipped (see above); receipt OCR and proof-of-payment screenshots are still deferred and still gated on these same constraints. These constraints were researched against current platform docs on 2026-07-26 and are **settled** — they're properties of the stack, not preferences to re-litigate. Status, shipping order, and the still-open product questions live in [CHANGELOG.md](CHANGELOG.md), not here.

- **Uploads never proxy through a Route Handler.** Vercel Functions cap every request/response body at 4.5 MB on every plan, which a phone photo exceeds. Use Supabase signed direct-upload URLs: the client uploads straight to Storage, and the Route Handler only mints a short-lived token.
- **No Supabase Auth — use a server-side gatekeeper.** Prisma connects directly to Postgres, so *our* requests never travel through PostgREST and Storage's usual `auth.uid()`-based policies don't apply. **This means PostgREST is bypassed by us, not closed to everyone else** — it is a separate, internet-facing door onto the same database, and securing it is a separate job. See [Database security posture](#database-security-posture); the gap that phrasing once hid caused a real exposure, closed 2026-08-21. The Route Handler authorizes the request via Prisma, then uses the Storage service-role key to issue the signed URL. Don't stand up Supabase Auth just for uploads.
- **Storage layout:** one bucket, folder-prefixed by feature + session id, public read — the same "anyone with the session link" trust model the app already applies to names, phone numbers, and expense amounts. File attachments don't warrant a stricter standard than the data they sit next to.
- **OCR output is never auto-committed.** A mandatory human review + per-item participant-assignment step sits between parsed output and any persisted `Expense`/`ExpenseSplit` row. The reviewed result saves as an ordinary `CUSTOM` split — no new `SplitType`.

Compress images client-side before upload regardless of the 50 MB per-file ceiling; the binding limit is the free tier's 1 GB total / ~10 GB monthly egress over the app's lifetime.

## Settlement Algorithm

Use greedy debt simplification to minimize the number of transactions:

1. Calculate net balance for each participant (total paid - total owed)
2. Separate into creditors (positive balance) and debtors (negative balance)
3. Greedily match largest debtor to largest creditor
4. Repeat until all balances are zero

This is the standard approach used by Splitwise. Implement in `lib/settle.ts`.

**Reconciliation tolerance:** balances are compared to zero using `RECONCILED_EPSILON = 0.005` (half a centavo), exported from `settle.ts` and reused by the CUSTOM-split guard in `lib/expenseSplits.ts`. A full-cent threshold (the original value) misclassifies a genuine 1-centavo balance as "already settled" and silently drops it from the plan — found in the 2026-07-19 audit, fixed the same day. Half a centavo is small enough to never swallow a real balance, large enough to absorb floating-point noise from repeated arithmetic on already-rounded amounts.

## Payment Display

Neither GCash nor Maya exposes a public deep-link URL that pre-fills a peer transfer — payments happen inside the authenticated app after the user is already logged in. Attempting to construct one (e.g. `gcash.me/<number>/<amount>`) produces a broken or useless link.

**Copy-to-clipboard, all three method types:** show the payment detail with a label and a copy-to-clipboard button. The payer reads the amount from the settlement row, copies the number/account, and completes the transfer inside the relevant app themselves.

- **GCash / Maya:** label is `GCash ·` or `Maya ·`; the full phone number is displayed and copied.
- **Bank Transfer:** entry form accepts bank name and account number as two separate inputs; stored in `payment_details` as `"Bank Name - Account Number"`. On the settle screen the bank name is used as the label (e.g. `BPI ·`) and **only the account number is copied** — pasting the bank name alongside the account number would be confusing and serve no purpose.

**QR code (shipped 2026-08-16):** QR Ph is the BSP-standardised interoperable payment QR standard — GCash, Maya, and most bank apps can scan it — but any QR image a participant uploads works, not only QR Ph-badged ones. See "QR Ph Code Upload — Shipped" above for the full flow. It supplements the copy-to-clipboard option above rather than replacing it: the settle and read-only view screens render whichever the participant has set — QR, phone/account details, both, or neither.

Receipt OCR and proof-of-payment screenshot upload remain deferred — see "Out of Scope for V1" and "V2 File Uploads — Locked Constraints" above.

## API Routes

```
POST   /api/sessions                                         # Create session
GET    /api/sessions/:sessionId                              # Get session with participants + expenses
POST   /api/sessions/:sessionId/participants                 # Add participant
PATCH  /api/sessions/:sessionId/participants/:participantId  # Set own payment method
POST   /api/sessions/:sessionId/expenses                     # Add expense
PATCH  /api/sessions/:sessionId/expenses/:expenseId          # Edit an expense in place (rebuilds its splits)
PATCH  /api/sessions/:sessionId/expenses                     # Bulk reorder: reassign sort_order from a full ordered id list
DELETE /api/sessions/:sessionId/expenses/:expenseId          # Delete an expense
GET    /api/sessions/:sessionId/settlements                  # Get the settlement plan: frozen rows (with paid flags) if finalized, else a live preview
POST   /api/sessions/:sessionId/settlements                  # Finalize (freeze) the plan; re-calling it later recomputes and resets paid flags
PATCH  /api/sessions/:sessionId/settlements/:settlementId    # Mark one frozen payment paid or unpaid
```

All routes live under `app/api/sessions/**` as Next.js Route Handlers (see the Project Structure section above — participants/expenses/settlements are session-scoped, not split into separate top-level routes).

## Deployment

| Service  | Purpose                    | Cost |
| -------- | --------------------------- | ---- |
| Vercel   | Next.js app (frontend + API) | Free |
| Supabase | PostgreSQL                  | Free |
| GitHub   | Source control + Actions (weekly Supabase keepalive cron) | Free |

Everything runs from the repo root — a single Vercel project, no separate backend deploy. `DATABASE_URL` is set per-environment in the Vercel dashboard, pointed at Supabase's pooled (6543, `?pgbouncer=true`) connection string; the direct (5432) string is used only for one-off CLI migrations, never in a deployed environment. See [README.md](README.md) for the full migration history and current architecture.

## Database security posture

Settled 2026-08-21 after a confirmed exposure — every table was readable *and writable* by anyone holding the published anon key. Full incident detail in [CHANGELOG.md](CHANGELOG.md). These are properties of the stack, not preferences.

- **RLS is enabled on every table in `public`, with deliberately zero policies.** Deny-by-default. Nothing should ever reach these tables through PostgREST, so there is no policy to write.
- **Zero policies doesn't lock the app out, because of owner-bypass.** Postgres exempts a table's owner from RLS, and Prisma connects as `postgres`, which owns all tables. **Never set `FORCE ROW LEVEL SECURITY`** — that strips the exemption and the app would start returning empty arrays with a `200`, which is the worst failure mode available: no error, anywhere.
- **`anon` and `authenticated` hold no grants**, and `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` keeps it that way for tables created later. This is the load-bearing half: Postgres has no "default RLS", so every future table needs its own `ENABLE ROW LEVEL SECURITY` statement, which relies on nobody forgetting.
- **Convention:** any future migration that creates a table must append its own `ENABLE ROW LEVEL SECURITY`.
- **`service_role` deliberately keeps its access.** It carries `BYPASSRLS`, so none of this ever protected against a leaked service key; revoking would close no real hole while removing a legitimate admin path.
- **Guard every grant statement with `to_regrole()`.** Local dev (`compose.yml`, `POSTGRES_USER: divvy`) has none of `anon`, `authenticated`, or even `postgres`. There is no `REVOKE ... IF EXISTS`, so an unguarded statement aborts the whole migration locally and in the shadow database. Corollary: a local run **cannot** prove the revoke works — it no-ops. Verify in production.
- **PostgREST config, complementary to the above:** `public` is not an exposed schema, and "Automatically expose new tables" is **off** (Integrations → Data API → Settings). Config-only and silently reversible, which is why the migration exists too.
- **Expect 6 INFO `rls_enabled_no_policy` advisor findings.** That is the correct end state. **Do not clear them by adding a permissive policy.**
- **Ports are not interchangeable.** Runtime uses the pooled `6543` string with `?pgbouncer=true` (a Prisma flag — `psql` rejects it). Migrations must use `5432` session mode: the migrate engine takes a session-scoped `pg_advisory_lock`, which transaction pooling would lose.
- **Vercel injects environment variables at build time.** Changing `DATABASE_URL` in the dashboard does nothing until a redeploy — this caused a 5-day production outage. Vercel also never runs `migrate deploy`; schema migrations are always applied by hand before the code that needs them ships.

## Data retention

Sessions older than a month are deleted automatically, so old bill-splitting data doesn't accumulate indefinitely against the free tier's storage/egress ceiling (see [Deployment](#deployment)).

- **Schema side — took two migrations, not one.** `20260828021955_participant_expense_cascade_on_session_delete` made `Participant.session` and `Expense.session` cascade on Session delete, matching `Settlement.session`'s existing cascade; previously they were RESTRICT by deliberate design (see the schema comments) on the reasoning that an *accidental* delete path should fail loudly, and this cleanup job is that intentional path.
  - **Those three were not sufficient, and the claim that they were is what let the gap ship** (ticket 26, found 2026-08-29). `ExpenseSplit.participant_id` still had no delete action, and `ExpenseSplit` is **two hops** from `Session` — reachable only via `Expense` — so Postgres runs the `Participant` cascade's referential check before the `Expense → ExpenseSplit` cascade has cleared those rows. `DELETE FROM "Session"` failed with `23503` for **any session that had expenses**, i.e. every real one. Because the job is a single statement, the whole delete rolled back and nothing was cleaned, silently. `Settlement` escaped only because it hangs directly off `Session` (one hop), which is exactly why reading the schema didn't reveal it.
  - **Closed by `20260829005904_expensesplit_participant_cascade_on_delete`** — `ExpenseSplit.participant` now cascades too. `Settlement.debtor`/`creditor` deliberately stay restrictive: deleting a Participant outright must still fail loudly rather than void one side of a payment plan.
  - **The lesson is the testing one, not the schema one.** The original cascade was reasoned about in schema comments and passed review; what nobody did was *run the statement*. `tests/retention.integration.test.ts` now does, and is verified to fail if the cascade is reverted.
- **Scheduling side is Supabase-side config, not a Prisma migration** — run once, directly against the Supabase SQL Editor:
  ```sql
  create extension if not exists pg_cron with schema pg_catalog;

  select cron.schedule(
    'monthly-session-cleanup',
    '0 3 1 * *', -- 3 AM UTC on the 1st of each month
    $$ delete from "Session" where created_at < now() - interval '1 month' $$
  );
  ```
  Kept out of `prisma/migrations/` on purpose: local dev's `postgres:16` image (`compose.yml`) has no `pg_cron` extension compiled in at all — unlike the RLS grants above, there's no `to_regrole()`-style guard for a missing *extension*, so an unguarded `CREATE EXTENSION pg_cron` would abort every local migration and the shadow database Prisma uses for `migrate dev`. This mirrors the existing PostgREST-exposure setting above: config-only, applied by hand, not expected to exist locally.
- To change the retention window or inspect/unschedule the job later: `select cron.alter_job(job_id, schedule := '...')` or `select cron.unschedule('monthly-session-cleanup')`, run in the same SQL Editor.

## Design Principles

- Mobile-first (friends will use this on their phones via shared link)
- Minimal UI — one action per screen
- No account creation friction
- Philippine payment methods first (GCash, Maya)

## Engineering Principles

- **Industry standards first** — prefer widely-adopted tools, patterns, and conventions over custom solutions
- **Containerize everything that can be containerized** — local dev uses Podman (rootless, daemonless) via `compose.yml`; production services should also be container-ready
- **Local dev parity** — the local environment should mirror production as closely as possible; no "works on my machine" gaps
- **Container runtime:** Podman (not Docker) — use `podman-compose` for compose workflows
- **Comments:** Every non-trivial line or block gets a simple one-liner comment explaining what it does — code should be readable to someone seeing it for the first time
- **Code reviews use subagents:** always run a full code review via parallel subagents rather than one inline pass — default is three, split by *lens* (Correctness, Security, Best-Practice/Smells), each auditing the change under review — the diff or commit range, plus the sibling sites of any pattern the diff touches (see "Enumerate the class" in CONTRIBUTING.md) — consolidated into one severity-ranked report. Splitting by lens (not by area, e.g. frontend/backend) avoids "seam-blindness," where a bug living in the contract between two areas falls in the gap between two reviewers who each only look at one side. Spawn them via the `Agent` tool with `subagent_type: correctness-reviewer`, `security-reviewer`, and `best-practice-reviewer` (defined in `~/.claude/agents/`, read-only tool access, `correctness-reviewer`/`security-reviewer` pinned to Opus) — not `general-purpose`. Each agent already knows its lens's checklist; the prompt only needs to carry the review's context (see below), not the lens definition.

### When to run a review

Reviews fire at **phase/feature boundaries**, not per-change. A boundary is a coherent unit someone can actually judge — not "route 4 of 11 ported."

- **Per-change review is an anti-pattern here.** A reviewer looking at one route mid-port can't check the only thing that matters (does this still match the old behaviour?), and a hook firing on every `Edit` produces noise that trains you to skim. The test suite answers parity continuously; a reviewer answers it worse and at a checkpoint.
- **A fix commit is not its own review boundary.** A commit whose only job is closing prior review findings gets folded into the fix before it lands — via the same session's judgment, not a fresh review cycle — rather than reviewed afterward as new work. Reviewing a fix's fix is the per-change anti-pattern above, one level removed; see CONTRIBUTING.md's "Review findings: what earns a ticket" for what still warrants filing.
- **Skip mechanical phases.** Data migrations and file moves are verified by "does the data match" and "does it build," not by reading code.
- **Highest-value review is the one on the test suite itself** — tests that encode wrong behaviour turn every later phase into false confidence, which is worse than no tests.

### Reviews must carry their context

Subagents start cold: they have not read the conversation that produced the change. A review prompt **must** state the contract the change was written against — what is meant to stay identical, what is meant to change, and which tickets are deliberately in scope. It must also state the triage bar: report findings introduced by this diff at any severity, and pre-existing findings only at High or Medium — see CONTRIBUTING.md's "Review findings: what earns a ticket" for why.

Without it, findings are just the reviewer rediscovering decisions already made, and the real findings get lost in that noise.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
