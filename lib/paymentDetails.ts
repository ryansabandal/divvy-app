import type { PaymentMethodType } from "./types";

// Shared label for each payment method type. BANK_TRANSFER's own display label is never this
// generic "Bank" value — it prefers the participant's actual stored bank name (see
// components/PaymentAction.tsx) — so this entry only ever serves as that fallback plus the
// payment-method tab/status text, which don't have a bank name to show.
export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  GCASH: "GCash",
  MAYA: "Maya",
  BANK_TRANSFER: "Bank",
};

// The stored encoding for a BANK_TRANSFER payment method: "Bank Name - Account Number".
// One home for this format so all call sites agree on the separator instead of each
// re-deriving it (a silent mismatch would corrupt bank details across the app).
const BANK_DETAILS_SEPARATOR = " - ";

// Split a stored bank_transfer payment_details string back into its two entered fields.
// Falls back to an empty bank name if the separator is missing (defensive — shouldn't
// happen for data written by formatBankDetails below, but guards against malformed rows).
export function parseBankDetails(details: string): { bankName: string; accountNumber: string } {
  const separatorIndex = details.indexOf(BANK_DETAILS_SEPARATOR);
  if (separatorIndex === -1) {
    return { bankName: "", accountNumber: details };
  }
  return {
    bankName: details.slice(0, separatorIndex),
    accountNumber: details.slice(separatorIndex + BANK_DETAILS_SEPARATOR.length),
  };
}

// Combine the two entered fields into the single string persisted in payment_details.
export function formatBankDetails(bankName: string, accountNumber: string): string {
  return `${bankName}${BANK_DETAILS_SEPARATOR}${accountNumber}`;
}
