"use client";

import { useState } from "react";
import { parseBankDetails } from "@/lib/paymentDetails";
import type { Participant } from "@/lib/types";

// How the debtor should pay the creditor for one settlement row, based on the creditor's saved
// method. None of GCash/Maya/Bank offer a working public deep link, so all three show the detail
// plus a Copy button — the payer copies the number/account and pays inside the relevant app
// themselves. Shared between the settle and view pages so the two never drift apart.
export function PaymentAction({
  creditor,
  creditorName,
}: {
  creditor: Participant | undefined;
  creditorName: string;
}) {
  // Local to this row — two rows copied within 1.5s can both show "Copied!" at once, which is fine
  const [copied, setCopied] = useState(false);

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!creditor || !creditor.payment_method_type || !creditor.payment_details) {
    return (
      <p className="text-xs text-navy/40">
        {/* Explicit {" "} — JSX strips the space after an expression when the text node wraps
            onto another line, rendering "Annhasn't" */}
        {creditorName}
        {" "}hasn&apos;t added a payment method yet
      </p>
    );
  }

  // Bank transfer is stored as "Bank Name - Account Number" — show bank name as label,
  // display and copy only the account number so the payer doesn't accidentally include the bank name
  let methodLabel: string;
  let displayText: string;
  let copyText: string;
  if (creditor.payment_method_type === "BANK_TRANSFER") {
    const { bankName, accountNumber } = parseBankDetails(creditor.payment_details);
    methodLabel = bankName || "Bank";
    displayText = accountNumber;
    copyText = accountNumber;
  } else {
    methodLabel = creditor.payment_method_type === "GCASH" ? "GCash" : "Maya";
    displayText = creditor.payment_details;
    copyText = creditor.payment_details;
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-beige px-3 py-2">
      <span className="text-sm text-navy">
        <span className="text-navy/40">{methodLabel} · </span>
        {displayText}
      </span>
      <button
        type="button"
        onClick={() => handleCopy(copyText)}
        className="btn-compact shrink-0"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
