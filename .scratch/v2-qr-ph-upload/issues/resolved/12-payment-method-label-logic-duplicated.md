Status: resolved
Severity: Low
Category: Best-Practice

# Payment-method label mapping duplicated across three call sites

app/[sessionId]/page.tsx has two separate GCASH/MAYA/BANK_TRANSFER -> label cascades (one for the tab buttons, grown from 3 to 4 arms by this slice; one for the collapsed-row status text), and components/PaymentAction.tsx has a third, partial one. lib/paymentDetails.ts is this repo's documented single home for payment-method-encoding logic, but no label map lives there or anywhere else — each cascade re-derives the mapping independently. This slice itself had to duplicate its QR-awareness edit into two of the three places instead of one.

Location: app/[sessionId]/page.tsx:593, :566-574; components/PaymentAction.tsx:69

Fix sketch: a small shared `PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string>` map, probably in lib/paymentDetails.ts, imported by all three call sites.

Found by: best-practice-reviewer, Phase G.2 review (2026-08-16).

## Comments

**2026-09-05 — restored from `fix-on-touch`**, alongside h18/h14/h15/qr-13. This ticket lives inside
the `PaymentMethodEditor` that h18's decomposition extracts — see `.scratch/BACKLOG.md` cluster E —
so it rides with that cluster's restoration rather than being fixed standalone; see h18's comment
for the full reasoning.

**2026-09-13 — resolved.** `PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string>` added to
`lib/paymentDetails.ts` and applied at all three sites named above (`page.tsx`'s collapsed-row
status text and tab-button labels moved into the new `PaymentMethodEditor.tsx`;
`PaymentAction.tsx:64`'s GCash/Maya line). `PaymentAction.tsx`'s `BANK_TRANSFER` arm deliberately
keeps its own `bankName || "Bank"` fallback, untouched by the map. 3-lens reviewed as part of
Cluster E Slice 2 — see CHANGELOG.md's dated entry.
