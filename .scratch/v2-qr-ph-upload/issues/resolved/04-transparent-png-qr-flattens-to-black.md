Status: resolved
Severity: Medium
Category: Correctness

# Transparent-background QR image likely flattens to a solid black square on compression

`compressImage()` draws the source image onto a canvas and exports as JPEG with no `fillStyle`/`fillRect` first. A fresh canvas is transparent black; JPEG has no alpha channel, so transparent regions composite against a browser-determined (commonly black) background at export. `accept` explicitly admits `image/png` and `image/webp`, both alpha-capable — a transparent-background QR (a common output of QR generators and some wallet "save QR" exports) with black modules would compress to an all-black, unscannable image. Nothing in the flow detects this: upload succeeds, the thumbnail renders fine (it's still a valid JPEG), and the failure only surfaces when a payer tries to scan it.

Location: lib/imageCompress.ts:28-32

Fix sketch: fill the canvas white before drawing — `ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);` — before `ctx.drawImage(...)`. Makes the flatten deterministic and QR-safe regardless of browser/engine.

Found by: correctness-reviewer, Phase G.2 review (2026-08-16).

Resolved 2026-08-22: applied the fix sketch verbatim (white fill before `drawImage`). Re-reviewed clean by a scoped correctness-reviewer subagent, which confirmed the fill ordering and canvas dimensions are correct.

Real-device verification with an actual transparent-background QR was dropped by user decision (2026-08-22): transparent-background QR isn't a realistic everyday case for this app's users, so the code fix (which is strictly correct regardless — see the review above) ships without a live-device scan test. Closed as resolved without that verification step.
