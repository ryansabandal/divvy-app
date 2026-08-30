Status: resolved
Severity: Low
Category: Best-Practice

# qrObjectPrefix stays exported after its last external consumer was removed

Location: lib/storage.ts (qrObjectPrefix)

Ticket 02 replaced the QR route's `path.startsWith(qrObjectPrefix(sessionId))` check with
`isMintedQrPath()`. After that change, `qrObjectPrefix` has no importer anywhere in the repo outside
`lib/storage.ts` itself (grep confirms the only other hit is a prose mention inside a code comment in
tests/sessions.integration.test.ts, not an import). ESLint's unused-vars rule does not catch an
unused *export*, so tooling won't surface this.

Leaving it exported keeps available, one import away, precisely the ingredient the just-removed
`startsWith` check was built from — the same footgun ticket 02 closed. It is also inconsistent with
this same review slice's own reasoning: ticket 05 un-exported `parseJsonBody` on the grounds that its
only safe use is behind another function in the same file. Same argument, opposite outcome here.

Fix: drop `export` from `qrObjectPrefix`; it is only ever called from within lib/storage.ts
(`createQrUploadUrl` and `isMintedQrPath`).

Found by: best-practice-reviewer, 3-lens Tier 1 review (2026-08-29).

**2026-08-30 — fixed.** `export` dropped from `qrObjectPrefix` in `lib/storage.ts`. Re-confirmed before the change that its only remaining references are the two in-file callers (`createQrUploadUrl`, `isMintedQrPath`) plus one prose mention inside a comment in `tests/sessions.integration.test.ts` — not an import. `tsc` and `npm run lint` both clean afterwards.
