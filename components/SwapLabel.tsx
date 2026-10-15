// Button text that crossfades between two labels (e.g. "Copy" → "Copied!") instead of snapping.
// Both labels stay mounted, stacked in one grid cell, so the button is always as wide as the
// longer one and never jumps. Shared by the session page's link buttons and PaymentAction's Copy.
export function SwapLabel({
  swapped,
  idle,
  active,
}: {
  // True while the active label should show — e.g. `copied` from useCopyToClipboard
  swapped: boolean;
  // Resting text, e.g. "Copy"
  idle: string;
  // Confirmation text, e.g. "Copied!"
  active: string;
}) {
  return (
    <span className="label-swap" data-swapped={swapped}>
      {/* aria-hidden on whichever label is faded out, so a screen reader only reads the visible one */}
      <span aria-hidden={swapped}>{idle}</span>
      <span aria-hidden={!swapped}>{active}</span>
    </span>
  );
}
