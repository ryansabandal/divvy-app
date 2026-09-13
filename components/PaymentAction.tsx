"use client";

import { useEffect, useState } from "react";
import { parseBankDetails, PAYMENT_METHOD_LABELS } from "@/lib/paymentDetails";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";
import type { Participant } from "@/lib/types";

// How the debtor should pay the creditor for one settlement row, based on the creditor's saved
// method(s). None of GCash/Maya/Bank offer a working public deep link, so the number/account
// shows with a Copy button; a QR code (any payment app's, not necessarily QR Ph-badged) shows as
// a tappable-to-enlarge image instead — the payer scans it in-app rather than typing anything. A
// participant can have either, both, or neither; QR supplements the number/account, never
// replaces it. Shared between the settle and view pages so the two never drift apart.
export function PaymentAction({
  creditor,
  creditorName,
}: {
  creditor: Participant | undefined;
  creditorName: string;
}) {
  // Local to this row — two rows copied within the flash window can both show "Copied!" at once
  const { copied, copy: handleCopy } = useCopyToClipboard();
  // Full-screen QR view — a settle-row thumbnail is too small to actually scan
  const [enlarged, setEnlarged] = useState(false);

  // Escape closes the enlarged view, same as tapping the backdrop or the close button
  useEffect(() => {
    if (!enlarged) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setEnlarged(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enlarged]);

  const hasQr = Boolean(creditor?.qr_code_url);
  const hasDetails = Boolean(creditor?.payment_method_type && creditor?.payment_details);

  // The bug this replaced: bailing here whenever payment_method_type/payment_details were missing
  // meant a participant with *only* a QR code rendered as having no payment method at all.
  if (!creditor || (!hasQr && !hasDetails)) {
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
  let methodLabel = "";
  let displayText = "";
  let copyText = "";
  if (hasDetails && creditor.payment_method_type && creditor.payment_details) {
    if (creditor.payment_method_type === "BANK_TRANSFER") {
      const { bankName, accountNumber } = parseBankDetails(creditor.payment_details);
      methodLabel = bankName || "Bank";
      displayText = accountNumber;
      copyText = accountNumber;
    } else {
      methodLabel = PAYMENT_METHOD_LABELS[creditor.payment_method_type];
      displayText = creditor.payment_details;
      copyText = creditor.payment_details;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {hasQr && creditor.qr_code_url && (
        <>
          <button
            type="button"
            onClick={() => setEnlarged(true)}
            className="flex items-center gap-2 self-start rounded-xl bg-beige px-3 py-2"
          >
            {/* Plain <img> (not next/image) so long-press / right-click "Save image" works
                natively once enlarged below — the payer needs to walk away with the image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={creditor.qr_code_url}
              alt={`${creditorName}'s QR code`}
              className="h-12 w-12 rounded-lg border border-navy/10 bg-white object-contain"
            />
            <span className="text-sm text-navy/60">Tap to enlarge</span>
          </button>

          {enlarged && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${creditorName}'s QR code, enlarged`}
              className="overlay-backdrop fixed inset-0 z-50 flex items-center justify-center bg-navy/80 p-6"
              onClick={() => setEnlarged(false)}
            >
              {/* Stops propagation so tapping the image itself doesn't close the overlay before a
                  long-press can register — only the backdrop or the explicit close button do */}
              <div className="overlay-panel relative" onClick={(e) => e.stopPropagation()}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={creditor.qr_code_url}
                  alt={`${creditorName}'s QR code, enlarged`}
                  className="max-h-[80vh] max-w-[80vw] rounded-2xl bg-white p-4"
                />
                <button
                  type="button"
                  onClick={() => setEnlarged(false)}
                  aria-label="Close"
                  className="icon-btn absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-navy shadow-md"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {hasDetails && (
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
      )}
    </div>
  );
}
