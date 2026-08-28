Status: ready-for-agent
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
