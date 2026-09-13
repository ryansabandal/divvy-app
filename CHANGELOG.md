# Divvy — Changelog & Project History

Dated record of what changed, why, and how it was verified — migration phases, hardening audits, and V2 planning notes. For current architecture, see [README.md](README.md); for product scope, see [CLAUDE.md](CLAUDE.md); for local setup, see [CONTRIBUTING.md](CONTRIBUTING.md).

> **Current priority (updated 2026-09-13) — resume the deferred holistic-review work below.**
> Cluster E is now fully shipped: Slice 2 (`PaymentMethodEditor` extraction + qr-12) and Slice 3
> (`ExpenseList`/`ExpenseForm` extraction, closing h18 + h14) both landed this session, each 3-lens
> reviewed and fixed — see their dated entries below. `.scratch/plans/session-page-decomposition.md`
> is fully executed. Open choices for next session: ticket 39 (`handleQrRemove` missing `finally`,
> filed during Slice 2), writing up the pre-settled QR 08/09/11 decisions, or h36's direction
> (expense cap unenforced under concurrency). The animation follow-up work (plans 002-005) was
> 3-lens reviewed and fixed the same day — see "Animation follow-up sweep" below.
>
> **Deferred, not dropped — resume now:** the holistic code review fix plan below
> (updated 2026-08-28). This session ran the full 3-lens subagent review (Correctness/Security/
> Best-Practice+Performance) against the entire repo, not a diff — the first whole-repo audit since
> the 2026-07-19 V1 hardening pass. **25 new tickets filed** under `.scratch/holistic-review-2026-08-28/issues/01` through `25`, ranked into a fix plan at `.scratch/plans/idempotent-snacking-hummingbird.md` (also readable at `~/.claude/plans/idempotent-snacking-hummingbird.md`). Headline: the authorization model is correct — every session-scoped route re-verifies ownership against `:sessionId`; no cross-tenant path, no XSS sink, no raw SQL, no leaked secret. The damage is in float comparisons, one missing length cap, and duplication already edited in lockstep twice.
>
> **Next session starts with Tier 1** (tickets 01-08, correctness+security bugs) — self-contained fixes, no refactors, no API shape changes:
> - **01 (High)** — stale-plan detection misses ~89% of one-centavo changes (`Math.abs(a-b) < 0.01` on cent-valued doubles); verified independently across 200,000 cases before filing.
> - **02 (Med)** — QR upload `path` is the only API field with no length cap; fixing it (validate exact minted shape) also closes existing ticket `v2-qr-ph-upload/10` (`..` bypass) for free.
> - **03 (Med)** — expense reorder breaks permanently past 50 expenses (creation uncapped, reorder capped); collides with ticket 10's query-narrowing fix at the same call site — implement both, don't let one drop the other's requirement.
> - **04 (Med)** — the P2025 concurrent-delete fix (resolved ticket 15) only landed on one of three routes with the same shape; reorder and expense-delete still 500 on a race.
> - **05 (Med)** — malformed JSON 500s instead of 400ing; the code comment's Express-parity claim is false.
> - **06 (Med)** — client/server CUSTOM-split tolerance mismatch (0.01 vs 0.005).
> - **07 (Low)** — EVEN/QUANTITY remainder push can go negative; **must be fixed by distributing centavos, not clamping** — clamping breaks the sum invariant. Verified fix across 150,000 cases before filing.
> - **08 (Low)** — frozen settlements returned with no `orderBy`.
>
> Do steps in the order listed in the plan file — step 8 (orderBy) before converting the `toBeCloseTo` remainder assertions to exact `toBe`, since step 7's distribution fix changes the exact expected values. Tier 2 (efficiency, tickets 09-14), Tier 3 (redundancy, 15-19 — includes the `ExpenseRow`/`SettlementRow` extractions below), Tier 4 (docs/hygiene, 20-23), and Tier 5 (design decisions: 24 orphaned QR storage, 25 unverified bucket config) are deferred to later sessions, filed but not started. Full ranked detail, verification steps, and the ticket-bookkeeping note (ticket 10 closes via 02; ticket 05's scope is expanded by 17 — neither's `Status:` was flipped, pending confirmation) are in the plan file.
>
> **Superseded by the above:** the `ExpenseRow` extraction (previously TOP PRIORITY, not started) is now ticket `15` in the new numbering, with a **larger confirmed scope** — the split-type label cascade and per-split list are identical between pages too, not just the card shell. A second, previously unfiled `SettlementRow` duplication (ticket 16) was found alongside it. See `.scratch/plans/session-payer-declutter.md` for the original review that first flagged the lockstep-editing pattern.
>
> **QR review-fixes session (`.scratch/plans/v2-qr-review-fixes.md`) — ticket 03 shipped 2026-09-12, see dated entry below.** Of the 15 tickets under `.scratch/v2-qr-ph-upload/issues/`, 8 are now resolved (01, 02, 03, 04, 05, 13, 14, 15 — moved to `issues/resolved/`), 8 FK indexes and keepalive hardening are done (see below), and 91/91 integration tests pass against live Storage. **Now open and next: Step 6** — write the 3 pre-settled decisions for tickets 08/09/11 into CHANGELOG + ticket files (do not re-ask, already decided via AskUserQuestion), then Step 7 (remaining docs, staging for user-run commits). Full resume-state detail is in the plan file's header. Note ticket 10 in this list is expected to close as a side effect of the new review's ticket 02, not as its own stretch item.
>
> **Open follow-ups from the 2026-08-21 incident** (detail in the section below). **Keepalive hardening (2026-08-22): curl side done, notification side still open.** `supabase-keepalive.yml` now uses `--fail-with-body --max-time 30 --retry 2 --retry-delay 10` instead of a bare `--fail`, so a real failure surfaces its response body and a single transient blip no longer produces a red run. But the intended fix — "a failed run notifies instead of sitting silently" — turned out to already exist: GitHub's Settings → Notifications → Actions → "failed workflows" email was **already enabled** before this session, and it is the exact channel that carried the 2026-08-04/07/10 and 08-16 failures that nobody acted on. So this is not closed; it's a live open question of *why* an enabled notification didn't produce action (missed email vs. an email that reads as low-signal noise), and "harden the curl call" alone doesn't answer it. **The 8 `unindexed_foreign_keys` findings are closed (2026-08-22).** `@@index` added to all 8 FK columns in `schema.prisma` (`Participant.session_id`; `Expense.session_id`/`paid_by`; `ExpenseSplit.expense_id`/`participant_id`; `Settlement.session_id`/`from_id`/`to_id`), generating migration `20260821232039_add_fk_indexes` — exactly 8 plain `CREATE INDEX` statements, confirmed by a scoped correctness review before applying. Applied locally, then to production by hand via the session-pooler `5432` string (`DATABASE_URL='<direct-5432-string>' npx prisma migrate deploy`, single-quoted — Vercel never runs `migrate deploy`). Verified on the advisor board: the 8 findings are gone, the 6 INFO `rls_enabled_no_policy` findings remain (correct), and 8 new INFO `Unused Index` findings appeared — expected and **not actionable**: `pg_stat_user_indexes` starts a fresh index at zero, and normal query traffic clears it over time. A production session page rendering participants confirmed owner-bypass is intact. Still deferred after that: the `ON FUNCTIONS` default-privilege residual (accepted — no functions exist and `public` is unexposed). The 6 INFO `rls_enabled_no_policy` findings are the intended end state — do **not** clear them with a permissive policy. The DB password was rotated at session close; any future rotation needs the new `DATABASE_URL` on **both** Production and Preview **plus a redeploy**, and note a warm function instance can keep serving on its existing socket, so a `200` right after a rotation does not prove the new value is live.
>
> The forest-cream design refresh (palette, Instrument Serif, bento summary tiles) closed 2026-08-16 — UI tuning, 3-lens review (security clean; one Low correctness fix, three best-practice nits, all fixed), and docs all done, committed as `a04f901`. Detail in `.scratch/design-refresh-forest-cream/issues/`.

V1 is feature-complete, deployed, and **formally closed** (2026-07-19). The **serverless migration** off Railway is also **complete** (2026-07-26, phases 0 through F below), and its post-migration backlog (Phase 5) is fully closed. V2 groundwork (shared settlement UI components, tickets 04/11) closed 2026-08-15. What's left is the deferred V2 trio, gated on Storage setup above.

### Production outage + PostgREST exposure (resolved 2026-08-21)

Two unrelated problems surfaced in the same session. Keeping them apart was most of the work: the session opened with Supabase Security Advisor CRITICAL findings and the belief that they were causing the project to be paused. **They weren't — advisories never pause a project, and the project was never paused.** A real, separate outage was running underneath.

**Problem 1 — production was down for ~5 days (the outage actually being felt).**

- **Symptom:** every DB-touching route returned `500` with an empty body (`/api/health`, `/api/sessions/:id`); `/` returned `200` because it's a static shell. The empty body is by design — [app/api/health/route.ts](app/api/health/route.ts) lets the error throw uncaught, so the cause is visible only server-side.
- **Root cause:** Vercel's runtime log gave it exactly — Prisma `P2010` wrapping Postgres `28P01`, `password authentication failed for user "postgres"`. The Supabase DB password had been rotated on 2026-08-16 (it had briefly appeared in an editor buffer) and `DATABASE_URL` was updated in the Vercel dashboard — but **Vercel injects environment variables at build time, so a dashboard edit never reaches an already-running deployment.** Production kept presenting the old credential until something forced a rebuild. Last successful keepalive: 2026-08-16 04:02 UTC — the same day as the rotation. That session's commits straddle the ping, so the two can't be ordered precisely; the date is the link, not the clock.
- **Fix:** reset the DB password, updated `DATABASE_URL` on Production + Preview to the pooled `6543` string with `?pgbouncer=true`, redeployed `main` from the Vercel UI. `/api/health` → `200 {"status":"ok"}`.
- **Why it went unnoticed for 5 days:** `supabase-keepalive.yml` fails into the Actions tab. Hardening it was deferred at the time, but this is the second time the failure history has been the only evidence of a problem. The keepalive had in fact also failed 2026-08-04/07/10 then passed 08-13/16; that fail→pass→fail shape initially argued *against* a static config break and is still unexplained — treat the earlier three as possibly separate.
- **2026-08-22 follow-up — the notification channel was not actually silent.** Checked GitHub's own failed-workflow email setting (Settings → Notifications → Actions): it was **already enabled**, meaning those four failures were emailed and still went unactioned. "Add a notification" was the wrong diagnosis — the gap is between notification and action, not between failure and notification. Curl-side hardening (`--fail-with-body`, `--max-time`, `--retry`) was applied regardless since it's a correctness improvement independent of the notification question, but the underlying open follow-up is not resolved by it.
- **Two gotchas worth keeping:** `?pgbouncer=true` is a **Prisma** parameter, not libpq — `psql` rejects it outright with `invalid URI query parameter`. And connection strings need **single** quotes in bash; a `!` in a password triggers history expansion inside double quotes.

**Problem 2 — every table was readable and writable by anyone holding the published anon key.**

- **The 9 CRITICAL findings** (6× `rls_disabled_in_public`, 3× `sensitive_columns_exposed`) shared one root cause: Supabase pre-registers default privileges granting `anon`/`authenticated` access to any table created in `public` by the `postgres` role — exactly how Prisma migrations create them — and PostgREST serves those at `/rest/v1/*`. The dashboard's **"Automatically expose new tables"** toggle is the front end for this, and it was on.
- **Confirmed exploitable, not theoretical.** Before the fix, `GET /rest/v1/Session?select=*` with only the anon key returned every row of every table — including real phone numbers and bank account numbers in `Participant.payment_details` — with `INSERT`/`UPDATE`/`DELETE` available too.
- **This is not the accepted public-bucket decision.** That decision ([CLAUDE.md](CLAUDE.md#v2-file-uploads--locked-constraints)) stands unchanged: it covers Storage objects sitting behind unguessable UUID paths, and its trust model is "anyone with the session link sees *that session*". This finding was "anyone at all reads and modifies *everything*" — outside the model. The line that let the gap hide said Prisma "bypass[es] PostgREST and RLS", which is true of *our* path; it does not mean PostgREST is closed to everyone else. That sentence has been sharpened.
- **Fixed with two complementary levers**, config and code:
  1. **Dashboard** (Integrations → Data API → Settings): removed `public` from **Exposed schemas** and turned **"Automatically expose new tables"** off. Immediate, but config-only and silently reversible.
  2. **Migration** `20260821223122_enable_rls_and_revoke_api_grants` — durable and in-repo. Six `ENABLE ROW LEVEL SECURITY` statements with **deliberately zero policies** (deny-by-default; nothing should ever reach these tables through PostgREST), plus `REVOKE ALL` on all tables/sequences from `anon`/`authenticated`, plus `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ... REVOKE`.
- **Why zero policies doesn't lock the app out:** Postgres exempts a table's **owner** from RLS unless `FORCE ROW LEVEL SECURITY` is set. Prisma connects as `postgres`, which owns all six tables. This was **verified as a gate before applying**, through the pooled `6543` path rather than the SQL Editor — Studio connects via its own privileged route and would have reported a role the app never uses. A wrong reading here has the worst possible failure mode: `200` with empty arrays, no error anywhere.
- **Why both layers, not just RLS:** RLS alone yields `200 []` — safe, but indistinguishable from an empty database. The `REVOKE` turns it into a hard `42501 permission denied`.
- **`ALTER DEFAULT PRIVILEGES` is the load-bearing half.** Postgres has no "default RLS" — every future table needs its own `ENABLE ROW LEVEL SECURITY`, which depends on nobody forgetting. Revoking the default privileges is the only protection that applies automatically to tables created later.
- **`service_role` is deliberately not revoked**, deviating from Supabase's own snippet: it carries `BYPASSRLS`, so none of this ever protected against a leaked service key, and revoking would close no real hole while removing a legitimate admin path.
- **Local replay:** the migration is guarded with `to_regrole()` so the identical file runs on local Postgres, where `compose.yml` uses `POSTGRES_USER: divvy` and **none** of `anon`, `authenticated`, or even `postgres` exist. There is no `REVOKE ... IF EXISTS`; an unguarded `REVOKE ... FROM anon` aborts the whole migration. The `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` needs its **own** guard for the same reason. Consequence: a local run **no-ops past the REVOKE entirely** and cannot prove it works — production verification was not optional.
- **Verified in production:** all 6 tables `relrowsecurity = true`, `relforcerowsecurity = false`; `has_table_privilege` false for `anon` SELECT/INSERT and `authenticated` SELECT on all 6; `Session` count non-zero (owner bypass intact); `pg_default_acl` for `postgres` reduced to `{postgres, service_role}` on tables and sequences; anon-key `curl` returns `PGRST205`; and a real session page rendered its participants on production.
- **Note the verification order matters:** removing `public` from exposed schemas makes the anon-key curl return `PGRST205` *whether or not* the REVOKE landed. Once step 1 is done, the `has_table_privilege` catalog query is the only thing that can distinguish "revoked" from "merely hidden".
- **Expected residual findings, all correct:** 6 new INFO `rls_enabled_no_policy` — the right end state for deny-by-default tables with no API consumer. **Do not resolve them by adding a permissive policy.** The 8 `unindexed_foreign_keys` performance findings were closed 2026-08-22 (see the priority callout above) via `@@index` additions in `schema.prisma`, migration `20260821232039_add_fk_indexes`.
- **Accepted residuals:** `supabase_admin`'s default privileges still grant `anon` — `postgres` cannot alter another role's defaults, and nothing here creates tables as that role. `ON FUNCTIONS` was omitted by decision: the schema has no functions, Prisma creates none, and with `public` unexposed PostgREST couldn't call one anyway.

**Also handled this session:** the `develop` → `main` merge (QR Ph support) went out before its schema migration had been applied to production — Vercel's build runs only `prisma generate && next build` and **never** `migrate deploy`, so `20260816031830_add_participant_qr_object_path` had to be applied by hand against the session-pooler `5432` string. Migrations need port **5432**, not `6543`: the migrate engine takes a session-scoped `pg_advisory_lock`, and transaction pooling would hand each statement a different backend and lose it.

### Expense display consistency + UI motion pass (shipped 2026-09-12)

Two independent changes, committed together as `78f76e5` (ad hoc — outside the holistic-review fix plan above, which is unaffected and remains next session's priority).

**Expense display consistency** — a user reported the expense list "looks inconsistent": some rows showed unit metadata (`1 units · ₱260.00 each`, `Myka ×1`), others showed `split evenly` or `custom split`. The reporter's implied fix (put units on every expense) was considered and rejected: an `EVEN` split makes no claim about units consumed, so a synthesized `×1` would assert something false. The actual cause was the opposite — every offending row was a `quantity === 1` `QUANTITY` split, where `1 units`, `₱260.00 each`, and `×1` all just restate the expense amount.

- **Rule shipped:** a row charged entirely to one person carries no split descriptor at all — covers a one-person `EVEN` split, a one-person `CUSTOM` split, and a quantity-1 `QUANTITY` split identically. A genuine multi-unit split (6 shots, Ryan ×4 / Myka ×2) is unchanged.
- **`components/ExpenseRow.tsx`** — the shared expense-card renderer (extracted 2026-09-05, commit `75e2f9a`) gates both the subtitle line and the `×N` suffix on a narrowed `unitCount` (`QUANTITY` with `quantity > 1`, else `null`); the descriptor `<p>` is skipped entirely rather than rendered empty, since it carries `mt-1` and an empty tag would leave a gap.
- **`lib/expenseBreakdown.ts`** — the same degenerate case existed in the settle/view per-person charge breakdown (`components/ExpenseBreakdown.tsx` renders an identical `×N` suffix); fixed at the source by adding `quantity` to `BreakdownExpense` and gating there, so the component itself needed no change.
- **`lib/expenseBreakdown.test.ts`** (new) — 4 tests, verified to fail when the gate is reverted.
- No schema, API, or form changes — the `QUANTITY` add/edit form still requires an entered quantity; this is display-only.

**UI motion pass** — the app had essentially zero motion (no `:active` states, no custom easing, no `prefers-reduced-motion` handling, one bare `transition-all`). Built via the `emil-design-eng` design-engineering skill's animation framework (should it animate → what purpose → what easing → how fast).

- **`app/globals.css`** — new tokens in plain `:root` (not `@theme inline`, since easings/shadows don't need generated utilities): `--ease-out`/`--ease-in-out` (strong custom cubic-béziers, not the weak CSS built-ins), two press-depth tokens (`--press-block: 0.985` for full-width CTAs, `--press-inline: 0.97` for compact/inline controls — a full-width button at the app's 384px column visibly contracts at 0.97, which reads as a flinch rather than a response), and two-layer ink-tinted shadows derived via `color-mix` from `--color-navy` so a future palette change propagates.
- Every button class (`.btn-primary`, `.btn-secondary`, `.btn-compact`, `.btn-toggle`) gained `:active` press feedback with an explicit transitioned-property list (never `transition: all`). Seven new classes added for entrance/overlay/hover motion: `.card-interactive`, `.icon-btn`, `.enter-rise` (`@starting-style`-based, staggers via a `--i` custom property capped at 240ms), `.panel-reveal`, `.overlay-backdrop`, `.overlay-panel`, `.progress-fill`.
- Wired into: the QR-code enlarge overlay (`components/PaymentAction.tsx`) — backdrop blur-fade, panel scale-from-center, since it's a centered dialog not an anchored popover; the per-person charge breakdown disclosure (`components/ExpenseBreakdown.tsx`); new expense rows on the session page — the entrance class sits on an inner wrapper `<div>` inside the sortable `<li>`, never the `<li>` itself, since `@dnd-kit`'s `useSortable` already drives that element's own `transform`/`transition` and a second transform on the same node would fight it; the recent-sessions list (`app/page.tsx`) with a staggered entrance and hover lift; the settlement progress bar (`components/SettlementProgress.tsx`), replacing its `transition-all`; and the edit/delete icon buttons on the session page.
- **`prefers-reduced-motion: reduce`** drops every transform (press, entrance, overlay scale) while keeping opacity/color transitions — reduced motion means gentler, not none.
- **Verified against current docs via Context7, post-implementation:** Tailwind v4's own upgrade guide confirms the `hover` variant is genuinely scoped inside `@media (hover: hover)` by default, so no extra manual gating was needed against sticky hover-after-tap on touch devices (confirmed independently by grepping the compiled CSS chunk). `@theme inline` is documented as being for values that reference *other* variables specifically, confirming the motion tokens' placement in plain `:root`. React's own source confirms `style={{ "--i": index }}` reaches the DOM exactly as intended (detected by the `--` prefix, set via `setProperty`) — the `as CSSProperties` cast used alongside it is only a TypeScript typing gap, not a workaround for actual behavior.
- **Verified:** `npx tsc --noEmit` clean, `npx vitest run lib` 28/28, both the home page and a session page serve `200` with no error markers in the rendered HTML (checked against the running `next dev` server rather than `next build`, which would have corrupted its `.next` cache).
- **Known, accepted limitation:** the QR overlay has no exit animation — it's conditionally mounted, so it unmounts instantly on close. A real exit needs an `isExiting` state + `onTransitionEnd`, which is real component surgery; the instant dismissal is snappy and consistent with "slow where the user decides, fast where the system responds," so this was left as-is rather than built.
- **Open, not yet resolved:** whether `--press-block: 0.985` reads as responsive enough — it's calibrated for a thumb on a touch screen and looks weak on a desktop mouse click by design; not planned to be tuned up for desktop, since that would overshoot on touch.

### QR upload: mobile gallery access fixed (shipped 2026-09-12, closes tickets qr-03 + qr-13)

Uploading a QR code from a mobile browser opened the camera directly, with no way to pick an existing screenshot from the photo library — reported by the user on real production hardware. Root cause: both QR file inputs (`app/[sessionId]/page.tsx`) carried `capture="environment"`, which tells mobile browsers to skip the picker sheet and launch the camera app. A secondary `accept="image/jpeg,image/png,image/webp"` list was also greying out otherwise-valid photos in the picker for no server-side benefit.

- **Fix:** dropped `capture="environment"` entirely (not a second control — the camera path is still reachable through the normal picker sheet once `capture` is gone) and widened `accept` to `image/*`. Safe to widen: `lib/imageCompress.ts` re-exports every upload to JPEG via `canvas.toBlob` regardless of input format, and the server never trusts a client-supplied MIME type or extension (`lib/storage.ts` mints its own UUID + `.jpg`) — `accept` was advisory-only.
- **Ticket 13 pulled forward from BACKLOG cluster E** (QR file-input JSX duplication) in the same session, since ticket 03's fix would otherwise have needed applying in two near-identical ~15-line blocks ~30 lines apart. Extracted `components/QrFileInput.tsx` — a named export following the `components/ExpenseRow.tsx` convention — used by both the "Add QR code" and "Replace" branches. Does not close the larger `PaymentMethodEditor` decomposition (ticket h18, still deferred, still needs its own plan); the new component is something that future decomposition would import, not reshape.
- **Reviewed** by correctness-reviewer, security-reviewer, and best-practice-reviewer in parallel, full diff context. Correctness and security: no findings — `accept`/`capture` were confirmed to never have been enforcement points, and the SVG-via-`image/*` angle was traced through the canvas re-encode and cleared. Best-practice: one finding (the new component's header comment narrated refactor history, against the repo's "keep rationale/history out of code" rule) — fixed same session.
- **Verified:** `npx tsc --noEmit` and lint clean; a repo-wide `grep -rn 'capture='` confirms zero remaining matches. No automated test covers this path — the repo has no browser-level test tooling — so a desktop smoke test (add/replace/remove QR, label/disabled-state behavior unchanged) plus a **real mobile-device retest post-deploy** (photo picker now offers both Photo Library and Take Photo) are the verification of record.
- Committed and pushed as `4de6022`.
- Also discovered stale during this session's doc pass and resolved: ticket h15 (`ExpenseRow` extraction, BACKLOG cluster E) had already shipped in `75e2f9a` but was never flipped — confirmed both `app/[sessionId]/page.tsx` and `app/[sessionId]/view/page.tsx` import the shared component.

### Animation follow-up sweep, 5 plans written and executed (2026-09-12)

A read-only `/find-animation-opportunities` sweep over the motion pass above (report at
`~/.claude/plans/frolicking-scribbling-toucan.md`) found 5 surviving opportunities — the settlement
plan list still popped in with no transition, three disclosure panels didn't use the existing
`.panel-reveal` class, the settlement card's paid-state color change snapped instead of easing, a
dragged expense card had no lift, and a 100%-settled plan had no completion beat. `improve-animations
plan` turned all 5 into self-contained execution plans at `.scratch/plans/animation-improvements/`
(001-005 + README), each stamped against commit `3ff8fa7`. All 5 were then executed this session.

- **001 — settlement list entrance.** New opacity-only `.enter-fade` primitive (later renamed, see
  003) applied to the settlement `<li>` on both settle and view pages. Opacity-only on purpose: the
  obvious choice, reusing `.enter-rise`, would have made the row the CSS containing block for
  `PaymentAction`'s enlarged-QR overlay (`position: fixed` with no portal, nested inside the row) —
  `.enter-rise` settles at `transform: translateY(0)`, which is a containing block; a bare opacity
  transition is not. **Committed as `9e4b942`.**
- **002 — `.panel-reveal` on the payment-method + payer disclosures.** JSX-only, no new CSS: the
  payment-method form and two payer pickers in `app/[sessionId]/page.tsx` now use the same class
  `components/ExpenseBreakdown.tsx` already had. One site needed care — the payer-override panel
  sits inside `<form className="flex flex-col gap-3">`, so its wrapper had to restate `flex flex-col
  gap-3` or the label row and select would silently lose their spacing.
- **003 — paid-row color transition, with a cascade fix 001 didn't anticipate.** The plan's written
  approach (add a `transition` to the shared `.card` class) would have silently done nothing:
  `transition` is a single CSS property, and 001's `.enter-fade` on the same `<li>` — added after
  003 was planned — would have overridden it by source order, with `tsc`/tests staying green either
  way. Resolved by renaming `.enter-fade` to `.settlement-row` and merging the entrance fade and the
  paid-state background/border colors into one declaration, with the stagger delay scoped inside the
  `transition` shorthand's opacity term specifically (a separate `transition-delay` longhand would
  have delayed the paid-state tint by up to 240ms, a worse bug than the one being fixed). New
  `.settlement-text` class for the row's name/amount `<span>`s, which carry only Tailwind utilities
  and needed a `color` transition of their own. Verified via Lightning CSS directly that the
  per-property delay survives inside the shorthand rather than being hoisted to a flat
  `transition-delay`.
- **004 — drag-pickup shadow.** `SortableExpenseCard`'s inline `style` object (dnd-kit sets
  `transition` inline on the sortable `<li>`, which silently beats any same-property CSS class rule)
  now merges in `box-shadow 160ms var(--ease-out)` and raises to `--shadow-md` while `isDragging`.
  Confirmed against the installed `@dnd-kit/sortable` type declarations that its own `transition` can
  be `undefined`, which is why the merge guards with `.filter(Boolean)`.
- **005 — settlement completion beat.** New `.enter-pop` primitive (scale 0.96→1 + opacity, 220ms) and
  a conditionally-mounted "🎉 Everyone's settled up" line in `components/SettlementProgress.tsx` when
  every row in a non-empty plan is paid. Deliberately mount-only, no `isExiting`/`wasIncomplete` state
  machine — same call already made for the QR overlay's exit animation above. Checked the component's
  own `aria-valuetext`-stays-in-sync-with-the-caption convention before adding a second visible line:
  it doesn't apply here, since the new line is a separate element in the reading order and doesn't
  touch either of the two strings that convention binds together.
- **Verified per plan:** `npx tsc --noEmit`, `npx vitest run lib` (28/28), and `npm run lint` clean
  after each of the 5. Feel-checked in a browser afterward (QR-overlay full-screen regression, the
  payer-override panel's `gap-3` spacing, drag lift, reduced-motion) and confirmed working.
- **Land as one commit:** 002-005 (001 is `9e4b942`) — 002/004 both touch `app/[sessionId]/page.tsx`
  and 003/005 both touch `app/globals.css`, so the plans no longer split cleanly by file path.
- **3-lens review (2026-09-13)** of the 002-005 diff, with 003's cascade fix carried as settled context.
  Security: no findings. Best-practice: four Lows (split/misplaced settlement CSS rules, an `.enter-pop`
  comment naming the wrong twin primitive, an over-long `.settlement-row` comment, two TSX comments —
  one duplicated, one asserting facts about other files), all fixed in place.
- **Correctness found a Medium that predates this work: the paid settlement row's teal tint had never
  rendered.** Tailwind v4 emits utilities inside `@layer utilities`, and every hand-written class in
  `app/globals.css` is unlayered — unlayered CSS beats layered CSS regardless of specificity, so
  `.card`'s white background and navy border silently overrode `bg-teal/5 border-teal/20` on the
  settle + view rows. 003's background/border transition therefore animated nothing; only the text
  fade was ever visible. Confirmed in headless Chromium (paid and unpaid rows both computed
  `rgb(255,255,255)`). Fixed with an unlayered `.settlement-row-paid` class after `.card`, replacing
  the utilities at both call sites; a repo-wide search found no other component class sharing an
  element with a conflicting colour utility. **Trap for future edits:** a Tailwind colour/border
  utility placed alongside any component class here (`.card`, `.bento-tile`, `.input`, `.btn-*`)
  loses to it — express the variant as a plain class instead. Wrapping the component classes in
  `@layer components` would fix this globally but was not done: it would flip every existing
  utility-vs-component conflict app-wide at once.
- **Debugging detour, not a code bug:** retesting the fix first showed "Failed to update payment" and
  no tint. Both traced to a stale Turbopack cache in `.next` — the served CSS was the previous day's,
  and every nested session route (`settlements/:id`, `expenses/:id`, `participants/:id`) 404'd to
  `/_not-found` HTML, which the settle page's `res.json()` can't parse. Stopping dev, `rm -rf .next`,
  and restarting fixed both. No build had run alongside dev this time, so the trigger is unknown.
- **Verified after fixes:** `npx tsc --noEmit` clean, `npx vitest run lib` 28/28, `npm run lint` 0 errors
  (1 pre-existing warning outside the diff); paid tint + fade confirmed in a browser by the user.

### Cluster E Slice 2 — `PaymentMethodEditor` extraction + qr-12 shared labels (2026-09-13)

Second of three sequenced boundaries in `.scratch/plans/session-page-decomposition.md`. Extracted
the whole GCash/Maya/Bank/QR payment-method editor (~180 lines: 6 state hooks, 3 handlers, the tab
UI) out of `app/[sessionId]/page.tsx` into `app/[sessionId]/_components/PaymentMethodEditor.tsx`,
taking `{ sessionId, participant, mutate, onClose }` as props. `page.tsx` shrank from 1008 to 788
lines. qr-13 (`QrFileInput` extraction) had already shipped separately (`4de6022`) — not part of
this slice.

- **Seeding moved from an imperative click-handler to `useState` lazy initializers.** The old
  `toggleExpandParticipant` wrote all six pieces of state by hand when a row expanded; now
  `PaymentMethodEditor` mounts fresh per participant (parent renders it only while
  `expandedParticipantId === p.id`, with `key={p.id}`) and each field seeds itself straight from
  the `participant` prop. No sync effect needed, and "form shows the previous participant's data"
  is unrepresentable by construction.
- **`onClose`/`mutate` kept as two separate props, not one**, to preserve a real pre-existing
  behavior difference: Save collapses the row (`onClose()` then `mutate()`), but a QR upload/remove
  never did (`mutate()` only) — a single combined callback would have silently started collapsing
  the row on every QR action.
- **qr-12 closed:** `PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string>` added to
  `lib/paymentDetails.ts`, applied at all three sites the ticket named (collapsed-row status text,
  the tab-button labels, and `PaymentAction.tsx`'s GCash/Maya line). `PaymentAction.tsx`'s
  `BANK_TRANSFER` arm deliberately keeps its own `bankName || "Bank"` fallback — the map is not
  applied there, since that would replace a real bank name with the generic word "Bank" on the
  settle/view screens.
- **3-lens review (2026-09-13).** Security: no findings — confirmed the extraction moves no new
  module into the client bundle, doesn't change any server-side authorization check (every write
  route re-validates `participantId` against `sessionId` regardless of what the client sends), and
  the QR signed-upload flow is byte-for-byte unchanged. Best-practice: 4 findings, all fixed —
  the tab-button labels had been copied verbatim without wiring to the new map (drift risk between
  two label sources); a `setSavingPaymentMethod(false)` after the Save-success `onClose()` was dead
  code (the component unmounts before that line's effect would matter); a comment on `onClose`
  narrated the refactor itself instead of the current contract; the bank-details seeding computed a
  throwaway object every render instead of using true lazy `useState` initializers.
- **Correctness: 1 Medium (pre-existing, filed as ticket 39, not fixed in this diff) + 1 Low
  (introduced, fixed).** `handleQrRemove` has no `finally`, so a rejected DELETE or refetch strands
  the QR controls disabled forever — identical to the pre-extraction code, filed rather than folded
  into this refactor so the extraction's own "behavior unchanged" claim stays independently
  verifiable. The introduced Low: collapsing a row's QR editor while an upload is still in flight
  now silently swallows a later failure, since the error state is local and unmounts with the row —
  accepted as a documented tradeoff of isolating each row's state (the old shared page-level state
  had the opposite bug, misattributing the error to whichever row was open when it resolved) rather
  than reintroducing a page-level error channel just to preserve a worse failure mode.
- **User-caught during the manual walkthrough, fixed same session:** the GCash/Maya "phone number"
  field and the Bank tab's "account number" field shared one text-state variable — pre-existing
  since before this extraction, not introduced by it, but only surfaced once someone actually
  clicked through the tabs. Switching tabs left whatever was typed sitting in the next tab's field
  under a different label. First fix: reset both fields on every tab switch, reseeded from the
  participant's saved value for that specific tab (blank otherwise).
- **That fix got its own follow-up 3-lens review, which found it was too broad.** Security: clean
  (net-positive — closes a case where a payment identifier could land in the wrong field).
  Correctness: 1 Medium — re-tapping the *already-active* tab silently wiped whatever was just
  typed (no `tab === activeTab` guard); 1 Low — GCash and Maya render the *same* plain
  "Phone number" field, so clearing between them wasn't actually required by the bug just fixed,
  and cost a retype for the common case of one number registered on both wallets (asked the user:
  keep the value between GCash↔Maya, only reset when the field's *meaning* changes); 1 Low (plausible)
  — tab buttons had no `disabled` while a Save was in flight, so switching tabs mid-save discarded the
  value being saved and, on failure, surfaced the error under the wrong tab. Best-practice: the new
  `PaymentTab` type and the tab-render loop's literal array were two unlinked copies of the same 4
  tabs; `seedFieldsForTab`'s `tab === "QR"` check was fully redundant (`payment_method_type` can
  never be `"QR"`, so the next clause already covers it).
- **Second fix unifies all four into one mechanism:** a `fieldGroup(tab)` helper groups GCash/Maya
  as `"phone"` (one shared meaning) versus Bank's `"bank"` and QR's `"qr"`; a tab switch only
  reseeds when the group actually changes, which — as a side effect of the same check — also
  covers re-tapping the active tab (a tab's group never differs from itself) without a separate
  guard. Tab buttons gained `disabled={savingPaymentMethod}`, matching the Save button's own guard.
  `PAYMENT_TABS` is now the one canonical array (`PaymentTab` derives from it via
  `(typeof PAYMENT_TABS)[number]`), and the redundant `"QR"` check was dropped.
- **Verified after both rounds:** `npx tsc --noEmit` clean, `npx vitest run lib` 28/28, `npm run
  lint` 0 errors (1 pre-existing warning outside the diff).

### Cluster E Slice 3 — `ExpenseList` + `ExpenseForm` extraction, closes h18 + h14 (2026-09-13)

Third and final slice of `.scratch/plans/session-page-decomposition.md`. Extracted the expense list
(drag-reorder + delete) into `app/[sessionId]/_components/ExpenseList.tsx` and the add/edit form
into `app/[sessionId]/_components/ExpenseForm.tsx`. `page.tsx` shrank from 788 to ~255 lines (1046
before Slice 1). `SortableExpenseCard` moved into `ExpenseList.tsx` alongside its only caller.

- **State representation change, deliberate:** the parent's `editingExpenseId: string | null` became
  `editingExpense: Expense | null`, so `ExpenseForm` can be remounted via a `key` that changes
  whenever which expense is being edited changes (same pattern as `PaymentMethodEditor`), rather
  than needing a sync effect or an imperative 8-setter `handleStartEdit` block. `resetForm`'s scope
  shrank to only the add→add case; edit-mode "reset" now happens by remounting instead.
- **h14 (full expense-list re-render per keystroke) closed by construction, no memo/useCallback.**
  `ExpenseList` and `ExpenseForm` are now sibling components; typing in the form's own state can no
  longer re-render the list, since they no longer share a parent's state for anything keystroke-driven.
- **v1-09 half-closed as fix-on-touch:** `React.SubmitEvent<HTMLFormElement>` → the idiomatic
  `React.FormEvent<HTMLFormElement>` in the moved `handleSubmitExpense`. `app/page.tsx`'s copy of the
  same ticket is untouched, still open.
- **3-lens review (2026-09-13).** Security: no findings — the four moved `fetch()` calls are
  byte-for-byte the same requests as before (same URLs/methods/bodies), the delete-confirmation gate
  is unmoved, and no user-supplied string gained a new injection surface. Best-practice: 4 findings,
  all fixed, all comment-quality — a "see the ordering note below" cross-reference left dangling in
  the file it was extracted out of; a comment in the parent narrating "the previous resetForm()"
  instead of describing current behavior; `resetForm`'s own comment still claimed to be "shared by
  cancel and add" after cancel stopped calling it (cancel is now a pure remount); and the rationale
  comment for the delete→clear-editing-expense guard was dropped when that logic became an inline
  JSX arrow function instead of a named block.
- **Correctness: 2 introduced Lows, both fixed.** (1) Re-clicking Edit on the *same* expense already
  open no longer re-seeded the form, since the remount key is keyed only on expense id, which
  doesn't change on a re-click — any unsaved dirty value or stale error just sat there. Fixed with an
  `editClickCount` counter, bumped on every Edit click and folded into the key
  (`` `${editingExpense.id}-${editClickCount}` ``), so a re-click always forces a fresh remount.
  (2) After a successful edit-mode save, clearing `editingExpense` synchronously (to match the old
  code's immediate `resetForm()`) meant `ExpenseForm` remounted — and its freshly-mounted `submitting`
  state reset to `false` — *before* the post-save `mutate()` refetch resolved, so the new blank
  add-form was interactive against not-yet-fresh session data for one round trip. The original single
  -component code kept the submit button disabled for that whole window. Fixed by reordering
  `handleExpenseSubmitted` to `await mutate()` before clearing `editingExpense`, so the still-mounted
  form (and its `disabled` submit button) survives the entire refetch; only once fresh data is in
  does the remount to a blank, enabled add-form happen.
- **Verified:** `npx tsc --noEmit` clean, `npm test` (`vitest run lib`) 28/28, `npm run lint` 0
  errors (1 pre-existing warning outside the diff), `npm run test:integration` 99/99 against a local
  dev server. Manual walkthrough via a scripted Playwright session (browser cached from a prior
  session, invoked through `npx playwright test` without adding it as a project dependency): added
  an expense in each of the three split modes, confirmed edit pre-fill, Cancel reverting to blank
  add-mode, delete-while-editing resetting the form, re-click-Edit re-seeding (the fix above), and a
  pointer-drag reorder surviving a page reload.

### Serverless migration (complete — 2026-07-26)

**Why:** eliminate the recurring Railway subscription. Installability (PWA or native iOS) was considered first and rejected for this purpose — a PWA or a native app is still just a client calling the same hosted API, so neither removes the hosting cost.

**Architecture achieved:** one Next.js app on Vercel (Route Handlers replacing Express), Supabase Postgres (chosen over Neon specifically because Supabase Storage unblocks the whole V2 trio — QR Ph, receipt OCR, proof-of-payment — currently gated on "no file-storage infra"). Local dev is unaffected: `compose.yml` Postgres under Podman, unchanged; no Supabase CLI (needs Docker, which conflicts with the Podman-only principle).

**Phases, condensed to what still explains current code** (all done 2026-07-26; full blow-by-blow no longer needed now the migration is a month-stable):

0. **Integration test suite** — `tests/sessions.integration.test.ts` (`npm run test:integration`) written against a configurable `TEST_BASE_URL` rather than wrapping the Express app directly, so the same file could prove parity once it ran clean against Next.js too. 3-lens review (swapped Security for a "Suite Quality & Portability" lens, since a test file has no attack surface) found 6 coverage gaps, all closed.
1-2. **Repo restructure + Supabase provisioning** — shared library code moved into the single Next.js app; Supabase Postgres provisioned (`ap-southeast-1`) and Railway's production data migrated across via containerized `pg_dump`/restore (neither host had `psql` installed locally — matches the "containerize everything" principle). Chosen over Neon specifically because Supabase Storage unblocks the V2 file-upload trio.
3. **Ported all 11 routes** to Next.js Route Handlers under `app/api/sessions/**`, folding in 8 hardening-backlog ticket fixes at the same time (see the disposition table below). Two Express behaviors had no Route Handler equivalent and needed replacements that are still load-bearing today: `router.param("sessionId", ...)`'s UUID gate → `requireValidSessionId()` called at the top of every handler with that segment; Express's `req.body === undefined` on an empty POST → `request.json()` throwing an uncaught `SyntaxError` instead, fixed via `parseJsonBody()`/`parseBody()` in `lib/requestBody.ts`. Reviewed twice (post-port, post-ticket-fold-in); both passes' correctness findings are already folded into the current code.
4. **Deploy & cutover** — same-origin relative fetches replaced the old `NEXT_PUBLIC_API_URL` cross-origin setup; `lib/db.ts` gained its `globalThis` HMR guard + `max: 1` pool; `package.json` gained a **build-time** `prisma generate` in addition to `postinstall` (Vercel caches `node_modules`, so `postinstall` alone was unreliable on cached deploys and caused a real build failure — **don't remove the build-time one**); `vercel.json` pinned `regions: ["sin1"]` to co-locate with Supabase. Railway (Express app + Postgres) and the old `backend/` directory were both decommissioned once cutover was confirmed.
5. **Post-migration backlog cleanup** — closed the last four open tickets (01 rate limiting via 2 Vercel WAF rules — see [README.md](README.md#rate-limiting-vercel-waf); 03 shared types module `lib/types.ts`; 12 `noUncheckedIndexedAccess`; 13 `Settlement` cascade). Detail folded into the disposition table below.

**Backlog ticket disposition** (of the 20 open tickets under `.scratch/v1-hardening-audit/issues/`):

| Fate | Tickets | Why |
| --- | --- | --- |
| Deleted outright | 08 | Single origin → no CORS config exists to move to an env var |
| Resolved by Phase 3 | 02, 06, 16, 17, 18, 19, 20, 21 | All were "a route is wrong somehow"; ported + fixed as part of the rewrite. Detail in the Phase 3 entry above |
| Resolved by Phase 5 | 01, 03, 12, 13 | 03 (shared types module) and 13 (`Settlement` missing `onDelete: Cascade`) were briefly, incorrectly logged in this table as "free" once the single-app move / fresh migrations happened — caught in a post-G doc-accuracy review (2026-07-26) and put back on the backlog alongside 01 (rate limiting) and 12 (`noUncheckedIndexedAccess`). All four actually closed in Phase 5 — detail in the Phase 5 entry above |
| Resolved 2026-08-15 | 04, 11 | Shared settlement UI components (`<PaymentAction>`/`<SettlementProgress>`/`<StalePlanBanner>`) extracted as V2 groundwork, folding in the progress-bar ARIA fix at the same time. Detail in [Shared settlement UI components](#shared-settlement-ui-components-added-2026-08-15-v2-groundwork--closes-tickets-04-11) above |
| Untouched — pure frontend | 05, 07, 09, 10, 22 | Migration doesn't come near them; revisit whenever. Ticket 10 was originally miscategorized into "Absorbed by Phase 3" — it's a stale frontend comment, unrelated to the route port; corrected 2026-07-26 |

**Safety net:** Phase 0's tests are what made folding 9 ticket fixes into a full 11-route rewrite safe rather than reckless — without them, a regression from the port and a regression from a ticket fix would have been indistinguishable.

**Code review timing for this migration specifically** (general policy is in [CLAUDE.md](CLAUDE.md#engineering-principles)): review after Phase 0 (highest value — wrong tests poison every later phase), after Phase 3 (the 8 folded-in ticket fixes are deliberate behavior changes the parity tests won't catch, since they're *supposed* to differ), and after Phase 4 (security lens on env vars and the pooled/direct connection split). Phases 1–2 were skipped — verified by "does the data match" / "does it build," not by reading code.

### Hardening (complete — 2026-07-19)

**Method** — a full-repo audit ran *first*, then fixes.

- Three parallel subagents split by *lens* — Correctness, Security, Best-Practice/Smells — each auditing the whole repo independently, consolidated into one severity-ranked report.
- **Why lens-split beats an area split** (e.g. frontend/backend): it avoids "seam-blindness", where a bug in the contract between two areas falls in the gap between two reviewers who each only look at one side. See [CLAUDE.md](CLAUDE.md#engineering-principles).
- **Triage** — bugs/correctness in scope for closing V1; smells and nice-to-haves backlogged.
- **Security came back clean on the big risk** — cross-session IDOR is properly defended (every route scopes its lookup by `session_id`), plus no injection, no XSS, no committed secrets, CORS already restricted.
- **One real settlement-math bug surfaced** (#2 below). Per the standing money-as-`Float` decision, it was contained locally with a tolerance fix rather than used as a reason to do the bigger integer-centavos refactor.

Fixed, in order:

1. **Unit tests for `settle.ts`** — added Vitest (`npm test` once, `npm run test:watch` interactive), replacing a placeholder script that just exited 1. 8 tests: empty input, exact single match, everyone-already-settled, greedy-minimizes-transaction-count, plus two regressions encoding #2.
2. **Settlement residual-cent bug** — a `0.01` threshold meant to absorb float noise was also large enough to misclassify a genuine 1-centavo balance as "already settled", silently dropping it from the plan. Fixed with `RECONCILED_EPSILON = 0.005`. Full detail under [Settlement algorithm](README.md#settlement-algorithm-libsettlets).
3. **CUSTOM-split guard tightened** — same constant; rejects hand-entered splits off by more than half a centavo instead of silently accepting up to a full cent of drift.
4. **Duplicate participant IDs** — a repeated id in `participant_ids` (EVEN) or `splits` (CUSTOM/QUANTITY) double-charged that person and inflated the even-share denominator while totals still "added up". Now rejected via a `Set` size check in all three split branches.
5. **Malformed session ids returned 500, not 404** — a non-UUID reached Postgres as a raw "invalid input syntax for type uuid" error before the route's own `if (!session)` check could run. Fixed with one param-validation gate covering every route with that param.
6. **Untrimmed participant name** — `POST .../participants` validated `name.trim()` for emptiness but persisted the untrimmed value, so `"  Bob  "` kept its whitespace. Now stores the trimmed name, matching session creation.
7. **Input size bounds** — Zod schemas had `.min()` on arrays but no `.max()`, so one request could nest unbounded participants or splits. Caps added: 50 participants/session, 50 entries per array, 100-char names, 200-char descriptions.
8. **API response leaks** — five routes returned raw Prisma rows, leaking `sort_order`, `created_at`, `session_id`, and the raw `paid_by` id. All now go through `serialize*` functions. Detail under [API routes](README.md#api-routes-appapisessions).
9. **Frontend duplication** — extracted `lib/fetcher.ts` and (at the time) `lib/apiUrl.ts`, replacing three copy-pasted fetchers and ~12 hand-concatenated URL call sites.
10. **Bank-details parsing duplicated 3×** — extracted to `lib/paymentDetails.ts`.

**Verified, not just written:** backend `tsc --noEmit` clean · 8/8 Vitest passing · frontend `tsc --noEmit` clean · full `next build` succeeded across all four routes.

**Backlogged from the same audit** — lower-priority tickets `01`–`13` under `.scratch/v1-hardening-audit/issues/` (see `docs/agents/issue-tracker.md`). Fate of each is in the disposition table below; full description lives in the ticket's own file (resolved ones moved to `issues/resolved/`). Still open: `05`, `07`, `09`, `10` — pure-frontend nice-to-haves, revisit whenever.

**Pre-existing, unrelated to this pass:** `npm audit` flags 3 moderate-severity vulnerabilities in Prisma's own dev tooling (`@hono/node-server`, via `@prisma/dev`). Fixing requires a Prisma downgrade, so it's left alone and noted for awareness.

### Edit & reorder expenses (added 2026-07-19, post-close)

Not part of the hardening pass above — noticed afterward, during regular use, that fixing a mistake on an expense meant deleting and re-adding it from scratch. Unlike the V2 trio below, neither addition needed new infrastructure, so both shipped directly rather than waiting for a V2 milestone.

- **Edit an expense in place** — `PATCH /api/sessions/:sessionId/expenses/:expenseId`, reusing the same validation and split-building logic as `POST` (see `buildExpenseSplits()` above) and the same session-scoped 404 pattern as `DELETE`. Frontend: the existing add-expense form doubles as the edit form, pre-filled from the tapped card.
- **Drag-and-drop reorder** — new `Expense.sort_order` column (autoincrement, same pattern as `Participant.sort_order`) plus a bulk `PATCH /api/sessions/:sessionId/expenses` that reassigns it from a full ordered id list. Frontend: `@dnd-kit/core` + `@dnd-kit/sortable`, chosen over the newer pre-1.0 `@dnd-kit/react` for API stability (see "Add-or-edit-expense form" in [README.md](README.md#pages--ui)).
- **Verified**, not just written: `tsc --noEmit` clean, 8/8 Vitest passing, full `next build` succeeding, plus a live Playwright smoke test against both features in a real browser (pre-fill correctness, no duplicate row after save, reorder surviving a page reload, zero console errors) — screenshots reviewed, not just assertions read.

### Per-person charge breakdown (added 2026-07-19, post-close)

Requested after live use: participants wanted to verify their own charges from the settle screen without scrolling back through every expense. Frontend-only — the data was already being fetched.

- **The literal ask ("line items that make up this payment") turned out to be ill-defined**, and that was worth catching before building: greedy debt simplification routes payments between people who may never have shared an expense. Verified by running the real `computeSettlements()` against a worked scenario — see the "Per-person charge breakdown" bullets under [Pages / UI](README.md#pages--ui) for the example and the full reasoning.
- **Built instead:** a per-*person* breakdown under each settlement row (`components/ExpenseBreakdown.tsx` + `lib/expenseBreakdown.ts`), on both the settle screen and the read-only view.
- **Shared, not duplicated** — one component used by both pages, deliberately avoiding compounding backlog ticket 04 (settle/view payment-action UI already duplicated).
- **Verified**, not just written: `tsc --noEmit` clean, full `next build` clean, plus live Playwright runs against two purpose-built sessions — one exercising the offsetting arithmetic (a debtor who also fronted an expense) and one forcing the partial-coverage note (a debtor split across two creditors). Screenshots reviewed; `aria-expanded`/`aria-controls` wiring confirmed against the live DOM.
- **Drive-by fix:** the read-only view rendered "Annhasn't added a payment method yet" — JSX strips the space after an expression when the text node wraps to another line. Pre-existing (the settle page was unaffected, its equivalent being on a single line), spotted in a verification screenshot, fixed with an explicit `{" "}`.

### Shared settlement UI components (added 2026-08-15, V2 groundwork — closes tickets 04, 11)

Backlog ticket 04 (settle/view payment-action + progress-bar UI duplicated) and ticket 11 (progress bar has no ARIA semantics), closed together. Not just cleanup — this is the recommended first V2 step (see below): QR Ph display and proof-of-payment status both land on this exact surface, so extracting it now means building each V2 feature once instead of twice.

- **`components/PaymentAction.tsx`** — the payment-method label/display/copy logic (GCash/Maya/Bank Transfer + the "hasn't added a payment method yet" fallback), previously a `renderPaymentAction` function on the settle page and an inline IIFE on the view page, byte-for-byte duplicated. Copy-state (`copied`, "Copied!" label) is now local to each row instead of one page-level `copiedKey` — a deliberate, minor behavior change: two rows copied within 1.5s can now both show "Copied!" at once, where before copying row B cleared row A's label.
- **`components/SettlementProgress.tsx`** — the progress bar, taking `{ settlements, frozen }` and computing paid/total/percentage internally (the `frozen` guard moved inside the component rather than staying a call-site `{frozen && ...}`, since the computation was only ever meaningful under that condition). Carries the ticket-11 fix: `role="progressbar"` plus `aria-valuenow`/`aria-valuemin`/`aria-valuemax`/`aria-valuetext`, screen-reader-equivalent to the existing "X of Y paid" text.
- **`components/StalePlanBanner.tsx`** — the amber "expenses changed since finalizing" warning, taking `children: ReactNode` since the two pages' closing sentences differ (settle can Recalculate; view can only ask the organiser) and settle's version contains a `<strong>` tag.
- **Deliberately not extracted:** the settlement row `<li>` itself (name → name, amount, paid styling) — settle wraps the name in a `<label>` with a paid-checkbox that view doesn't have, and the two rows are expected to diverge further once proof-of-payment lands (settle gets an upload control, view gets a read-only link). Revisit when that real shared shape is known.
- **Verified**, not just written: `tsc --noEmit` clean, lint clean (1 pre-existing unrelated warning), full `next build` clean, `npm test` 8/8, `npm run test:integration` 80/80 (HTTP-level, can't see a component extraction — the real check is below), plus a live Playwright click-through against a purpose-built session (GCash creditor, Bank Transfer creditor showing only the account number copied, a no-payment-method creditor exercising the fallback, a finalized plan with one row paid, and a forced-stale plan) with both settle and view screenshotted and reviewed. Three-lens subagent review (Correctness/Security/Best-Practice) came back clean on the actual component change.

### V2 (scoped 2026-07-26, groundwork started 2026-08-15, QR Ph upload shipped 2026-08-16)

All three needed file storage — solved once for all rather than building upload infra piecemeal. The Supabase Storage bucket is provisioned and live: it went in alongside the QR Ph upload build below, which is now substantially implemented — signed upload/persist/delete routes, client-side compression, and public display on the settle + view screens all working, 91/91 integration tests passing against the live bucket (see the priority callout at the top of this file). What's left on QR is a handful of open hardening tickets under `.scratch/v2-qr-ph-upload/issues/`, not the core build. Receipt OCR and proof-of-payment screenshot upload have not started.

- **QR Ph code upload** for payment methods — ✅ shipped 2026-08-16, live in production. Payer scans instead of copying a number. Detail: [CLAUDE.md](CLAUDE.md#qr-ph-code-upload--shipped-added-2026-08-16-post-v1-close), "QR code upload" under [Pages / UI](README.md#pages--ui).
- **Receipt photo OCR** — not started — auto-parse an itemised bill instead of manual entry
- **Proof-of-payment screenshot upload** — not started — let participants validate a payment was made

The platform constraints these have to be built against are settled and written up in [CLAUDE.md](CLAUDE.md#v2-file-uploads--locked-constraints) — signed direct-upload URLs (Vercel's 4.5 MB body limit rules out proxying), a server-side gatekeeper instead of RLS (this app has no Supabase Auth), and OCR output never auto-committing. QR Ph's shipped implementation follows all three, confirmed by reading `lib/storage.ts` and the `qr` route. A longer working document with per-feature schema sketches and an OCR-provider comparison sits at `.scratch/plans/v2-scoping-guiding-principles.md`, which is **gitignored and local-only** — the files linked above carry everything a fresh clone needs.

**Recommended sequencing** (confirm before starting, not final):

1. ✅ **Done (2026-08-15)** — ~~Ticket 04 first~~ — extracted the shared `<PaymentAction>` / `<SettlementProgress>` / `<StalePlanBanner>` components (ticket 11's ARIA folded in too). See [Shared settlement UI components](#shared-settlement-ui-components-added-2026-08-15-v2-groundwork--closes-tickets-04-11) above.
2. ✅ **Done (2026-08-16)** — ~~Supabase Storage bucket setup~~ — provisioned and configured alongside the QR Ph build; no longer a blocker for proof-of-payment either.
3. ✅ **Done (2026-08-16)** — ~~QR Ph upload~~ — smallest slice, validated the whole upload pipeline end to end with no new external provider. Open hardening tickets remain — see the priority callout at the top of this file.
4. **Proof-of-payment** — same pipeline, one more surface. Not started.
5. **Receipt OCR last** — the only one adding an external provider *and* a whole new review screen. Not started.

**Open product questions** — decide these at the start of the V2 session rather than defaulting into an answer:

- **OCR provider** — Claude API vision vs. Google Document AI vs. Tesseract.js (cost / accuracy / complexity tradeoffs in the scratch doc). Still open.
- **Proof-of-payment: who uploads** — the debtor, the creditor, or either? Still open.

**Decided (2026-08-15, ahead of the QR Ph session, so they don't get re-litigated once file-upload code is actually being written):**

- **QR Ph upload: supplements**, not replaces, the existing phone/account-number fields — participants without a QR Ph code keep the working copy-to-clipboard fallback.
- **HEIC** — converted client-side to JPEG before upload, rather than accepted as-is, riding along with the client-side compression step already locked in CLAUDE.md. **As shipped (2026-08-16):** this rides on the browser's own `<img>` HEIC decoding rather than a dedicated conversion library — works on most current iOS Safari versions, verify-first rather than assumed universal; an undecodable HEIC file fails the upload with a clear error instead of silently breaking. See `lib/imageCompress.ts`.

### Considered but intentionally not scheduled

- **Money as integer centavos** — amounts are stored as `Float`, so rounding logic is scattered. Integer centavos (or `Decimal`) would remove a class of rounding bugs.
  - **Status** — noted, not planned; the current per-cent-remainder reconciliation works.
  - **Re-confirmed 2026-07-19** — the audit *did* find a real rounding bug, and the deliberate call was to contain it with a tolerance fix rather than treat it as the trigger for this larger refactor.
