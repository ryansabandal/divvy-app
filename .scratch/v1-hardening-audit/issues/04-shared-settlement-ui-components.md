Status: backlog (not blocking V1 close)
Severity: Medium
Category: Best-practice

# Settlement payment-action + progress-bar UI duplicated

The copy-row JSX + method-label logic in settle/page.tsx:91-129 (renderPaymentAction) is duplicated as an inline IIFE in view/page.tsx:204-236. The progress-bar + totals computation (paidSettlements/paidAmount/totalAmount/progressPct) and markup is verbatim in both files.

Fix sketch: extract shared <PaymentAction> and <SettlementProgress> components.
