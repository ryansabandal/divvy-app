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
│   │   ├── page.tsx                          # Create session
│   │   ├── [sessionId]/page.tsx              # Session view
│   │   └── [sessionId]/settle/page.tsx       # Settlement screen
│   └── components/
├── backend/
│   ├── src/
│   │   ├── index.ts                          # Express app entrypoint
│   │   ├── db.ts                             # Shared PrismaClient instance
│   │   ├── routes/
│   │   │   └── sessions.ts                   # All /api/sessions/* routes — participants, expenses, and settlements are session-scoped, no independent top-level routes
│   │   └── lib/
│   │       └── settle.ts                     # Debt simplification algorithm
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
  session     Session        @relation(fields: [session_id], references: [id])
  payer       Participant    @relation(fields: [paid_by], references: [id])
  splits      ExpenseSplit[]
}

model ExpenseSplit {
  id             String      @id @default(uuid())
  expense_id     String
  participant_id String
  amount_owed    Float
  expense        Expense     @relation(fields: [expense_id], references: [id], onDelete: Cascade)
  participant    Participant @relation(fields: [participant_id], references: [id])
}

model Settlement {
  id          String      @id @default(uuid())
  session_id  String
  from_id     String
  to_id       String
  amount      Float
  session     Session     @relation(fields: [session_id], references: [id])
  debtor      Participant @relation("Debtor", fields: [from_id], references: [id])
  creditor    Participant @relation("Creditor", fields: [to_id], references: [id])
}

enum SplitType {
  EVEN
  CUSTOM
}

enum PaymentMethodType {
  GCASH
  MAYA
  BANK_TRANSFER
}
```

## V1 Features (Strict Scope)

- [x] Create a session (name the bill, add participants)
- [x] Add expenses (who paid, how much, description)
- [x] Even split or custom amounts per participant
- [x] Delete an expense (fix mistakes/duplicates)
- [x] Participant self-enters their payment method via the shared link (GCash/Maya number, or bank name + account number)
- [ ] Settlement screen — who owes who (minimized transactions)
- [ ] GCash payment link generation (`gcash.me/<number>/<amount>`)
- [ ] Maya payment link generation (`maya.ph/pay/<number>`)
- [ ] Shareable session link (read-only view for participants)

## Out of Scope for V1

- User authentication
- Recurring bills
- Push notifications
- Expense history across sessions
- Multi-currency
- Receipt photo upload + auto-parsing (OCR) — deferred to V2
- QR code upload for payment methods — deferred to V2 alongside OCR; both need file storage infrastructure this stack doesn't have yet, so solve that once for both rather than building it twice

## Settlement Algorithm

Use greedy debt simplification to minimize the number of transactions:

1. Calculate net balance for each participant (total paid - total owed)
2. Separate into creditors (positive balance) and debtors (negative balance)
3. Greedily match largest debtor to largest creditor
4. Repeat until all balances are zero

This is the standard approach used by Splitwise. Implement in `backend/lib/settle.ts`.

## Payment Links

```typescript
// GCash
const gcashLink = (number: string, amount: number) =>
  `https://gcash.me/${number}/${amount}`;

// Maya
const mayaLink = (number: string, amount: number) =>
  `https://maya.ph/pay/${number}?amount=${amount}`;
```

`BANK_TRANSFER` has no equivalent deep link — just display the bank name + account number (`payment_details`) directly for the payer to copy.

## API Routes

```
POST   /api/sessions                                         # Create session
GET    /api/sessions/:sessionId                              # Get session with participants + expenses
POST   /api/sessions/:sessionId/participants                 # Add participant
PATCH  /api/sessions/:sessionId/participants/:participantId  # Set own payment method
POST   /api/sessions/:sessionId/expenses                     # Add expense
DELETE /api/sessions/:sessionId/expenses/:expenseId          # Delete an expense
GET    /api/sessions/:sessionId/settlements                  # Get computed settlements
```

All routes live in `backend/src/routes/sessions.ts` (see the Project Structure section above — participants/expenses/settlements are session-scoped, not split into separate router files).

## Deployment

| Service | Purpose              | Cost      |
| ------- | -------------------- | --------- |
| Vercel  | Next.js frontend     | Free      |
| Railway | Express + PostgreSQL | Free tier |
| GitHub  | Source control       | Free      |

## Build Order

1. Prisma schema + Railway PostgreSQL setup
2. Express API — sessions, participants, expenses
3. Settlement algorithm (`settle.ts`)
4. Next.js frontend — session creation + expense entry
5. Settlement screen + payment links
6. Deploy to Vercel + Railway

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
