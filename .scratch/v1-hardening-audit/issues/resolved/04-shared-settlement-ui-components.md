Status: resolved
Severity: Medium
Category: Best-practice

# Settlement payment-action + progress-bar UI duplicated

The copy-row JSX + method-label logic in settle/page.tsx:91-129 (renderPaymentAction) is duplicated as an inline IIFE in view/page.tsx:204-236. The progress-bar + totals computation (paidSettlements/paidAmount/totalAmount/progressPct) and markup is verbatim in both files.

Fix sketch: extract shared <PaymentAction> and <SettlementProgress> components.

## Comments

Fixed 2026-08-15: extracted `components/PaymentAction.tsx` (payment-method label/display/copy + no-method fallback) and `components/SettlementProgress.tsx` (progress totals + markup, `frozen` guard moved inside the component). Both now shared by settle/page.tsx and view/page.tsx, replacing the duplicated `renderPaymentAction`/IIFE and progress-total computations. Done as V2 groundwork — see CHANGELOG.md's "Shared settlement UI components" section — since QR Ph display and proof-of-payment status both land on this same surface next.

One deliberate, minor behavior change: copy-state (`copied`) is now local to each `PaymentAction` instance instead of one page-level `copiedKey`, so two rows copied within 1.5s can now both show "Copied!" simultaneously, where before copying row B cleared row A's label.

Verified, not just written: `tsc --noEmit` clean, lint clean, full `next build` clean, `npm test` 8/8, `npm run test:integration` 80/80, plus a live Playwright click-through against a purpose-built session exercising GCash/Bank/no-method creditors, a finalized-with-one-paid plan, and a forced-stale plan — screenshots reviewed. Three-lens subagent review (Correctness/Security/Best-Practice) came back clean on the component change itself (correctness verified via server-rendered output-equality assertions against the pre-refactor JSX, 32/32 cases).
