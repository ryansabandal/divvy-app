"use client";

import { useState } from "react";
import { parseBankDetails, formatBankDetails, PAYMENT_METHOD_LABELS } from "@/lib/paymentDetails";
import { compressImage } from "@/lib/imageCompress";
import { QrFileInput } from "@/components/QrFileInput";
import type { Participant, Session } from "@/lib/types";
import type { KeyedMutator } from "swr";

const PAYMENT_TABS = ["GCASH", "MAYA", "BANK_TRANSFER", "QR"] as const;
type PaymentTab = (typeof PAYMENT_TABS)[number];

// GCash and Maya render the same plain "Phone number" field — same meaning, so a value typed
// under one stays valid under the other. Bank's "Account number" field means something different,
// and QR has no text fields at all. Two tabs only need a fresh seed when moving between groups.
function fieldGroup(tab: PaymentTab): "phone" | "bank" | "qr" {
  if (tab === "BANK_TRANSFER") return "bank";
  if (tab === "QR") return "qr";
  return "phone";
}

// What the bank-name/account-number fields should show for a given tab: the participant's own
// saved value if that tab is their actual saved method, blank otherwise. Used to seed the form on
// mount, and to reset it whenever a tab switch crosses into a different field group.
function seedFieldsForTab(tab: PaymentTab, participant: Participant): { bankName: string; paymentDetails: string } {
  if (tab !== participant.payment_method_type || !participant.payment_details) {
    return { bankName: "", paymentDetails: "" };
  }
  if (tab === "BANK_TRANSFER") {
    const { bankName, accountNumber } = parseBankDetails(participant.payment_details);
    return { bankName, paymentDetails: accountNumber };
  }
  return { bankName: "", paymentDetails: participant.payment_details };
}

// The inline form for one expanded participant row: pick a tab, fill it in. GCash/Maya/Bank save
// via PATCH with a Save button; QR is a fourth tab that uploads/persists on its own, no Save
// needed — the two never mix, so there's no "which method does this QR belong to" ambiguity.
// Mounted fresh per participant (parent renders it with key={participant.id} only while expanded),
// so every field seeds itself from `participant` in a useState initializer rather than needing a
// sync effect — collapsing and re-expanding a different row can never leak the previous row's draft.
export function PaymentMethodEditor({
  sessionId,
  participant,
  mutate,
  onClose,
}: {
  sessionId: string;
  participant: Participant;
  // Refetches the session — called after every persisted change (Save, QR upload, QR remove)
  mutate: KeyedMutator<Session>;
  // Collapses this row — called only after a successful Save; a QR upload/remove leaves the row
  // open so the participant can immediately see the result and take another QR action
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<PaymentTab>(
    // A participant with only a QR code (no phone/bank method) has payment_method_type === null —
    // without this fallback the form silently opened on GCash with an empty field, even though the
    // collapsed row correctly showed "QR code ✓"
    participant.payment_method_type || (participant.qr_code_url ? "QR" : "GCASH"),
  );
  const [bankName, setBankName] = useState(() => seedFieldsForTab(activeTab, participant).bankName); // bank transfer only — stored combined as "BankName - AccountNumber"
  const [paymentDetails, setPaymentDetails] = useState(() => seedFieldsForTab(activeTab, participant).paymentDetails); // phone number for GCash/Maya; account number for bank transfer
  const [savingPaymentMethod, setSavingPaymentMethod] = useState(false);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);
  const [qrAction, setQrAction] = useState<"uploading" | "removing" | null>(null);

  // Only reset the fields when the switch crosses into a different field group (e.g. into or out
  // of Bank's differently-meaning "Account number") — this also covers re-tapping the already-
  // active tab, since a tab never differs from its own group.
  function handleTabChange(tab: PaymentTab) {
    setPaymentMethodError(null);
    if (fieldGroup(tab) !== fieldGroup(activeTab)) {
      const seed = seedFieldsForTab(tab, participant);
      setBankName(seed.bankName);
      setPaymentDetails(seed.paymentDetails);
    }
    setActiveTab(tab);
  }

  // Save this participant's payment method, then collapse the form and refetch the session.
  // Only ever called from a tab where a Save button is rendered — QR's tab has none, since it
  // persists on its own via handleQrUpload/handleQrRemove below.
  async function handleSavePaymentMethod() {
    setPaymentMethodError(null);

    // Bank transfer needs two fields; GCash/Maya just need the phone number
    let details: string;
    if (activeTab === "BANK_TRANSFER") {
      if (bankName.trim() === "") { setPaymentMethodError("Enter the bank name"); return; }
      if (paymentDetails.trim() === "") { setPaymentMethodError("Enter the account number"); return; }
      // Combine into the stored format — only the account number is copied on the settle screen
      details = formatBankDetails(bankName.trim(), paymentDetails.trim());
    } else {
      if (paymentDetails.trim() === "") { setPaymentMethodError("Enter your phone number"); return; }
      details = paymentDetails.trim();
    }

    setSavingPaymentMethod(true);
    const res = await fetch(`/api/sessions/${sessionId}/participants/${participant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment_method_type: activeTab, payment_details: details }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setPaymentMethodError(body.error ?? "Failed to save payment method");
      setSavingPaymentMethod(false);
      return;
    }

    // No setSavingPaymentMethod(false) here — onClose() collapses this row, unmounting the
    // component before mutate() resolves, so a later state update would just be a no-op
    onClose();
    await mutate();
  }

  // Compress the picked file, mint a signed upload URL, PUT the bytes straight to Storage (plain
  // fetch — confirmed against the real bucket that no credentials are needed for this endpoint),
  // then persist the resulting path. Three requests, but only the middle one carries the image.
  async function handleQrUpload(file: File) {
    setPaymentMethodError(null);
    setQrAction("uploading");
    try {
      const compressed = await compressImage(file);

      const mintRes = await fetch(`/api/sessions/${sessionId}/participants/${participant.id}/qr`, { method: "POST" });
      if (!mintRes.ok) {
        const body = await mintRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to start QR upload");
      }
      const { path, signed_url } = await mintRes.json();

      const uploadRes = await fetch(signed_url, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: compressed,
      });
      if (!uploadRes.ok) throw new Error("Failed to upload QR image");

      const persistRes = await fetch(`/api/sessions/${sessionId}/participants/${participant.id}/qr`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!persistRes.ok) {
        const body = await persistRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save QR code");
      }

      await mutate();
    } catch (err) {
      // If this row got collapsed while the upload was in flight, this component has already
      // unmounted and the error has nowhere to surface — an accepted tradeoff of seeding each
      // row's state locally rather than at the page level
      setPaymentMethodError(err instanceof Error ? err.message : "Failed to upload QR code");
    } finally {
      setQrAction(null);
    }
  }

  // Clear this participant's QR code and delete the underlying Storage object
  async function handleQrRemove() {
    setPaymentMethodError(null);
    setQrAction("removing");
    const res = await fetch(`/api/sessions/${sessionId}/participants/${participant.id}/qr`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setPaymentMethodError(body.error ?? "Failed to remove QR code");
    }
    await mutate();
    setQrAction(null);
  }

  return (
    <div className="panel-reveal mt-2 flex flex-col gap-2 rounded-2xl border border-navy/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {PAYMENT_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => handleTabChange(tab)}
            disabled={savingPaymentMethod}
            className={`btn-toggle disabled:opacity-50 ${activeTab === tab ? "btn-toggle-active" : "btn-toggle-inactive"}`}
          >
            {tab === "QR" ? "QR" : PAYMENT_METHOD_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === "QR" ? (
        participant.qr_code_url ? (
          <div className="flex items-center gap-3">
            {/* Plain <img> (not next/image) so long-press / right-click "Save
                image" works natively — that's the whole point of a settle-screen
                QR: the payer needs to walk away with the image, not just view it */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={participant.qr_code_url}
              alt={`${participant.name}'s QR code`}
              className="h-16 w-16 rounded-lg border border-navy/10 object-contain"
            />
            <div className="flex gap-2">
              <QrFileInput
                label="Replace"
                uploading={qrAction === "uploading"}
                disabled={qrAction !== null}
                className="btn-compact cursor-pointer"
                onFile={handleQrUpload}
              />
              <button
                type="button"
                onClick={handleQrRemove}
                disabled={qrAction !== null}
                className="btn-compact disabled:opacity-50"
              >
                {qrAction === "removing" ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        ) : (
          <QrFileInput
            label="Add QR code"
            uploading={qrAction === "uploading"}
            disabled={qrAction !== null}
            className="btn-compact w-fit cursor-pointer"
            onFile={handleQrUpload}
          />
        )
      ) : activeTab === "BANK_TRANSFER" ? (
        // Two separate fields — combined on save so only the account number is copied later
        <>
          <input
            type="text"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Bank name (e.g. BPI)"
            className="input"
          />
          <input
            type="text"
            inputMode="numeric"
            value={paymentDetails}
            onChange={(e) => setPaymentDetails(e.target.value)}
            placeholder="Account number"
            className="input"
          />
        </>
      ) : (
        <input
          type="text"
          inputMode="numeric"
          value={paymentDetails}
          onChange={(e) => setPaymentDetails(e.target.value)}
          placeholder="Phone number"
          className="input"
        />
      )}

      {paymentMethodError && <p className="text-sm text-red-500">{paymentMethodError}</p>}

      {activeTab !== "QR" && (
        <button
          type="button"
          onClick={handleSavePaymentMethod}
          disabled={savingPaymentMethod}
          className="btn-compact self-end disabled:opacity-50"
        >
          {savingPaymentMethod ? "Saving…" : "Save"}
        </button>
      )}
    </div>
  );
}
