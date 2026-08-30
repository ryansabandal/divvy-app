Status: resolved
Severity: Low
Category: Security

# PUT's path-prefix check is bypassable with ".." segments; persists a malformed path

`path.startsWith(qrObjectPrefix(sessionId))` doesn't reject `..` segments, so a path like `dev/qr/<mySessionId>/../../qr/<victimSessionId>/<uuid>.jpg` passes the check and is written verbatim to `Participant.qr_object_path`. `publicObjectUrl()` interpolates it into a URL with no normalization; the browser then applies standard dot-segment removal before requesting it, so the rendered `<img>` resolves to the victim session's object — the check's stated purpose ("a caller can't point at an arbitrary object path elsewhere") isn't actually met.

Currently low-impact: the bucket is already public-read, so this doesn't cross a confidentiality boundary the model doesn't already grant; and Supabase's storage-js `remove()` matches paths by exact literal string (no `..` resolution), so cross-session *deletion* doesn't work either. The real risk is that a malformed path gets *persisted* — any future code path that resolves rather than exact-matches it (a `download`, `copy`, `createSignedUrl`, or a storage-api behavior change) would silently upgrade this to a real cross-session read/delete with zero further code change.

Location: app/api/sessions/[sessionId]/participants/[participantId]/qr/route.ts:50-56

Fix sketch: validate the exact minted shape instead of a prefix — `new RegExp('^' + escapeRegex(qrObjectPrefix(sessionId)) + '[0-9a-f-]{36}\\.jpg$')`. The mint is the only legitimate producer of these paths and its output shape is fully known (lib/storage.ts:35), so nothing legitimate is rejected.

Found by: security-reviewer, Phase G.2 review (2026-08-16).

## Comments

**2026-08-28, holistic review:** confirmed reachable as filed. `.scratch/holistic-review-2026-08-28/issues/02-qr-path-unbounded-length.md` applies the exact fix sketch above (regex against the minted shape) as the fix for an unbounded-length finding on the same field — implementing that ticket closes this one too, as a side effect, in the same edit. Not marking this resolved yet; leaving that for whoever implements the fix to confirm and flip.

**2026-08-29 — resolved, as a side effect of `holistic-review-2026-08-28/02` exactly as predicted above.** The `startsWith` prefix check is gone; the route now calls `isMintedQrPath(sessionId, path)`, an anchored full-string match against the minted shape, which lives in `lib/storage.ts` beside the mint itself so producer and validator cannot drift apart.

`..` cannot survive that anchor: the only characters permitted between the escaped prefix and the literal `.jpg` are those of a v4 UUID, and `.` is not among them.

Confirmed against the running route rather than by reading the regex — `dev/qr/<sid>/../../qr/<victim>/<uuid>.jpg` and `dev/qr/<sid>/../<uuid>.jpg` both return 400, while a well-formed `dev/qr/<sid>/<uuid>.jpg` still returns 200. That last row matters as much as the rejections: an over-tight anchor that also rejected legitimate paths would have broken QR upload entirely, and an early run of this probe did report a false rejection — caused by my probe omitting the `SUPABASE_STORAGE_PREFIX` value, not by the code.

Two refinements on this ticket's own fix sketch, worth recording because the sketch was reused verbatim in the newer ticket: `[0-9a-f-]{36}` also matches 36 hyphens, so a real v4 pattern replaced it; and the interpolated env prefix is now regex-escaped, since a metacharacter in `SUPABASE_STORAGE_PREFIX` would otherwise silently change what the anchor matches.
