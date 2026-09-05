"use client";

import { useState } from "react";

// One copy-to-clipboard flow, reused by the session page's two link buttons and PaymentAction's
// per-row copy button. Copies the given text, then flashes `copied` true for COPY_FLASH_MS so the
// caller can show a "Copied!" state.
const COPY_FLASH_MS = 2000;

export function useCopyToClipboard() {
  // Local to the caller — two buttons copied within the flash window can both show "Copied!" at
  // once, which is fine; each has its own state.
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FLASH_MS);
  }

  return { copied, copy };
}
