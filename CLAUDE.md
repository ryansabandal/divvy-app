# Divvy — Bill Splitting App

## Project Overview

A simple web app for friend groups to split casual expenses. Core design principle: simpler and less cluttered than Splitwise. No login required — one person creates a session, adds participants, and shares the link.

This file is the spec (what to build). See [README.md](README.md) for current build status, what's actually implemented, and architecture notes.

## Stack

- **Frontend:** Next.js (React) — deployed on Vercel
- **Backend:** Node.js + Express — deployed on Railway
- **Database:** PostgreSQL — hosted on Railway
- **ORM:** Prisma
- **Language:** TypeScript throughout

## Project Structure

```
divvy/
├── frontend/
│   ├── app/
│   │   ├── page.tsx                          # Create session + "Your recent sessions" list
│   │   ├── [sessionId]/page.tsx              # Session view (edit)
│   │   ├── [sessionId]/settle/page.tsx       # Settlement screen
│   │   └── [sessionId]/view/page.tsx         # Read-only participant view
│   └── lib/
│       ├── recentSessions.ts                 # localStorage helper — remembers visited sessions on this device
│       ├── paymentDetails.ts                 # parseBankDetails()/formatBankDetails() — one shared home for the "Bank Name - Account Number" encoding
│       ├── apiUrl.ts                         # apiUrl(path) — builds an absolute backend URL from NEXT_PUBLIC_API_URL
│       └── fetcher.ts                        # shared SWR fetcher (generic error message parameterized per page)
├── backend/
│   ├── src/
│   │   ├── index.ts                          # Express app entrypoint
│   │   ├── db.ts                             # Shared PrismaClient instance
│   │   ├── routes/
│   │   │   └── sessions.ts                   # All /api/sessions/* routes — participants, expenses, and settlements are session-scoped, no independent top-level routes
│   │   ├── schemas/
│   │   │   └── sessions.ts                   # Zod schemas for request body validation
│   │   └── lib/
│   │       ├── settle.ts                     # Debt simplification algorithm
│   │       └── settle.test.ts                # Vitest unit tests, incl. regression coverage for the residual-cent fix
│   ├── prisma/
│   │   └── schema.prisma
│   └── prisma.config.ts                      # DB connection for the Prisma CLI
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

> **Status:** V1 is **feature-complete, deployed, and formally closed** (hardening pass completed 2026-07-19 — a full-repo audit plus every fix it produced). See [README.md](README.md#roadmap--next-steps) for exactly what changed.
>
> **Next up:** no single blocking item. Either groom the backlog filed at `.scratch/v1-hardening-audit/issues/` (19 lower-priority items — DRY/typing/a11y cleanups, rate limiting, etc.; tickets 14/15 are separate, already resolved), or start V2 planning (QR Ph upload, receipt OCR, proof-of-payment — all gated on adding file-storage infra).
>
> **Post-close addition (2026-07-19):** edit-in-place and drag-and-drop reorder for expenses — see below. Neither needs file-storage infra, so unlike the V2 trio they weren't held for that gate; added as a direct quality improvement on an existing V1 feature instead.

- [x] Create a session (name the bill, add participants)
- [x] Add expenses (who paid, how much, description)
- [x] Even split or custom amounts per participant
- [x] Edit an expense in place (no more delete-and-recreate to fix a mistake) and drag-and-drop reorder the expense list
- [x] Delete an expense (fix mistakes/duplicates)
- [x] Participant self-enters their payment method via the shared link — GCash/Maya phone number, or bank name + account number entered as separate fields (stored combined as `"Bank Name - Account Number"`; only the account number is copied on the settle screen)
- [x] Settlement screen — who owes who (minimized transactions), with mark-as-paid tracking against a finalized plan
- [x] Display each participant's GCash/Maya number or bank account on the settle screen with a copy button so the payer can initiate the transfer themselves inside the relevant app
- [x] Shareable read-only session link (`/[sessionId]/view`) — expense breakdown + settlement plan, no edit controls; "Share view link" button on the session page copies the URL to clipboard
- [x] Return to a past session without login — home page shows a device-local "Your recent sessions" list (`frontend/lib/recentSessions.ts`, backed by `localStorage`, newest-first, capped at 10); "Copy session link" button on the session page for cross-device return (chosen over a raw sessionId copy/paste flow — a 36-char UUID is error-prone to hand-copy and the app already has a better container for it: the URL)
- [x] Design pass — navy/teal/sky-blue/beige/white palette; sticky navy header with Divvy wordmark; Tailwind v4 with plain CSS component classes (no `@apply` — Turbopack bypasses PostCSS, so `@apply` is never processed)

## Out of Scope for V1

- User authentication
- Recurring bills
- Push notifications
- Expense history across sessions
- Multi-currency
- Receipt photo upload + auto-parsing (OCR) — deferred to V2
- QR Ph code upload for payment methods — the intended V2 end-state; GCash, Maya, and most bank apps can scan QR Ph so the payer just scans instead of copying a number. Deferred alongside OCR; both need file storage infrastructure this stack doesn't have yet, so solve that once for both
- Proof-of-payment screenshot upload (for other participants to validate a payment) — deferred to V2 alongside OCR/QR upload, same missing file storage infrastructure
- Settlement status indicator (checkmark/"Done" on a session in the recent-sessions list once its plan is finalized and fully paid) — idea only, not scheduled; the `Settlement.paid` data already exists, but the recent-sessions list is device-local (`localStorage`), so this needs a batch status endpoint rather than one request per listed session

## Settlement Algorithm

Use greedy debt simplification to minimize the number of transactions:

1. Calculate net balance for each participant (total paid - total owed)
2. Separate into creditors (positive balance) and debtors (negative balance)
3. Greedily match largest debtor to largest creditor
4. Repeat until all balances are zero

This is the standard approach used by Splitwise. Implement in `backend/src/lib/settle.ts`.

**Reconciliation tolerance:** balances are compared to zero using `RECONCILED_EPSILON = 0.005` (half a centavo), exported from `settle.ts` and reused by the CUSTOM-split guard in `sessions.ts`. A full-cent threshold (the original value) misclassifies a genuine 1-centavo balance as "already settled" and silently drops it from the plan — found in the 2026-07-19 audit, fixed the same day. Half a centavo is small enough to never swallow a real balance, large enough to absorb floating-point noise from repeated arithmetic on already-rounded amounts.

## Payment Display

Neither GCash nor Maya exposes a public deep-link URL that pre-fills a peer transfer — payments happen inside the authenticated app after the user is already logged in. Attempting to construct one (e.g. `gcash.me/<number>/<amount>`) produces a broken or useless link.

**V1 approach (all three methods):** Show the payment detail with a label and a copy-to-clipboard button. The payer reads the amount from the settlement row, copies the number/account, and completes the transfer inside the relevant app themselves.

- **GCash / Maya:** label is `GCash ·` or `Maya ·`; the full phone number is displayed and copied.
- **Bank Transfer:** entry form accepts bank name and account number as two separate inputs; stored in `payment_details` as `"Bank Name - Account Number"`. On the settle screen the bank name is used as the label (e.g. `BPI ·`) and **only the account number is copied** — pasting the bank name alongside the account number would be confusing and serve no purpose.

**V2 target — QR Ph codes:** QR Ph is the BSP-standardised interoperable payment QR standard. GCash and Maya both support it, and most bank apps can scan it too. The intended V2 flow is:
1. Each participant uploads or generates their QR Ph code when entering their payment method.
2. The settle screen displays the QR image directly so the payer can scan it in-app.

QR Ph code upload needs file-storage infrastructure (the same gap blocking receipt OCR and proof-of-payment screenshots), so all three will be solved together in V2. See the "Out of Scope for V1" section.

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

All routes live in `backend/src/routes/sessions.ts` (see the Project Structure section above — participants/expenses/settlements are session-scoped, not split into separate router files).

## Deployment

| Service | Purpose              | Cost      |
| ------- | -------------------- | --------- |
| Vercel  | Next.js frontend     | Free      |
| Railway | Express + PostgreSQL | Free tier |
| GitHub  | Source control       | Free      |

**Gotcha:** `NEXT_PUBLIC_API_URL` (set in Vercel's project environment variables) must include the `https://` scheme. Without it, the browser resolves the value as a relative path off the frontend's own origin instead of an absolute URL to the Railway backend — requests 404 against Vercel itself, and the frontend's `JSON.parse` of that 404 HTML page throws `SyntaxError: unexpected character at line 1 column 1`.

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
- **Code reviews use subagents:** always run a full code review via parallel subagents rather than one inline pass — default is three, split by *lens* (Correctness, Security, Best-Practice/Smells), each auditing the whole repo, consolidated into one severity-ranked report. Splitting by lens (not by area, e.g. frontend/backend) avoids "seam-blindness," where a bug living in the contract between two areas falls in the gap between two reviewers who each only look at one side.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
