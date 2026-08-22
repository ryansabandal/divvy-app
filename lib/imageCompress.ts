// Client-side image compression before upload — pure <canvas>, no dependency. Draws the picked
// file to a canvas capped at 1600px on the longest edge and re-exports as JPEG at ~0.85 quality.
//
// This also doubles as the HEIC test: iOS Safari's <img> can decode HEIC directly in most current
// versions, in which case this just works with zero extra code. If a browser instead hands over a
// real HEIC file that <img> can't decode, the Image's error event fires and this rejects with a
// clear message — surfaced to the user via the existing paymentMethodError banner — rather than
// silently producing a broken upload. Only add a HEIC-decoding dependency if that path is actually
// hit on a real device; see the session plan for why this is verify-first, not assumed.
export async function compressImage(file: File): Promise<Blob> {
  const MAX_DIMENSION = 1600;
  const JPEG_QUALITY = 0.85;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Couldn't read that image — try a different photo or format"));
      img.src = objectUrl;
    });

    const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process that image on this device");
    // A fresh canvas is transparent, and JPEG has no alpha channel — without an explicit fill, a
    // transparent-background QR (PNG/WebP both allow one) composites against a browser-determined
    // backdrop, commonly black, which makes the dark QR modules unscannable. Nothing downstream
    // catches this: upload succeeds and the thumbnail renders fine, so fill white unconditionally.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("Couldn't process that image on this device");
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
