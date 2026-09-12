// The "pick a QR image" control — a styled <label> wrapping a hidden file input, so the label is
// what the user sees and taps. Rendered twice by the session page's QR tab: once as "Add QR code"
// when the participant has no QR yet, once as "Replace" when they do.
export function QrFileInput({
  label,
  uploading,
  disabled,
  className,
  onFile,
}: {
  // Idle button text — "Add QR code" or "Replace".
  label: string;
  // Swaps the label for "Uploading…" while this control's own upload is in flight.
  uploading: boolean;
  // True while any QR action is in flight, upload or remove — a remove should disable the
  // upload control too, so this is separate from `uploading` rather than derived from it.
  disabled: boolean;
  // Wrapper classes. The add-branch stands alone and needs w-fit; the replace-branch sits in a
  // flex row that already sizes it.
  className: string;
  // Handed the picked file; the caller owns compression, upload, and error reporting.
  onFile: (file: File) => void;
}) {
  return (
    <label className={className}>
      {uploading ? "Uploading…" : label}
      <input
        type="file"
        // image/* rather than a narrow list: nothing downstream trusts this attribute anyway —
        // compressImage() re-exports every upload to JPEG — so narrowing it only greys out
        // otherwise-valid photos in the picker. No `capture` attribute either: setting one makes
        // mobile browsers launch the camera directly and skip the picker entirely, blocking the
        // usual real-world case of picking an existing screenshot.
        accept="image/*"
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Resets the input so picking the same file again still fires
          // onChange — without this, re-selecting an identical filename
          // silently does nothing on most browsers
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}
