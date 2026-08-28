// "{name} fronted the bill" — the single-payer heading shown once instead of repeating "Paid by
// X" on every expense/charge row. Shared by the session, view, and settle pages so the three
// never drift apart (previously copy-pasted, which is how they drifted in the first place —
// settle/page.tsx never got one).
export function SessionPayerNote({
  payer,
  className = "mb-3 text-sm text-navy/40",
}: {
  // Non-null only when every expense shares one payer — see lib/sessionPayer.ts's
  // deriveSessionPayer(). null renders nothing, leaving the per-row "Paid by X" fallback visible.
  payer: { name: string } | null;
  // Callers with a heading directly above (page.tsx, view/page.tsx) pass "-mt-2 ..." to sit close
  // under it; settle/page.tsx has no such heading, so it keeps the default spacing.
  className?: string;
}) {
  if (!payer) return null;
  return <p className={className}>{payer.name} fronted the bill</p>;
}
