Status: ready-for-agent
Severity: Low
Category: Best-Practice

# Payment-method label mapping duplicated across three call sites

app/[sessionId]/page.tsx has two separate GCASH/MAYA/BANK_TRANSFER -> label cascades (one for the tab buttons, grown from 3 to 4 arms by this slice; one for the collapsed-row status text), and components/PaymentAction.tsx has a third, partial one. lib/paymentDetails.ts is this repo's documented single home for payment-method-encoding logic, but no label map lives there or anywhere else — each cascade re-derives the mapping independently. This slice itself had to duplicate its QR-awareness edit into two of the three places instead of one.

Location: app/[sessionId]/page.tsx:593, :566-574; components/PaymentAction.tsx:69

Fix sketch: a small shared `PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string>` map, probably in lib/paymentDetails.ts, imported by all three call sites.

Found by: best-practice-reviewer, Phase G.2 review (2026-08-16).
