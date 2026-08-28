Status: needs-triage
Severity: Low
Category: Security

# Upload content-type/size enforcement is dashboard config the repo has never confirmed is applied

The only server-side control over a QR upload's path is the pinned filename (`lib/storage.ts:36`, `createSignedUploadUrl(path, { upsert: false })`) — content-type and size are supplied entirely by the browser on the direct-to-Storage PUT (`app/[sessionId]/page.tsx:315`, `headers: { "content-type": "image/jpeg" }`, fully client-chosen) and are not asserted anywhere in code.

The intended controls — a 5 MB file-size limit and an `image/jpeg`/`image/png`/`image/webp` MIME allowlist — exist only as Supabase dashboard config, per `.scratch/plans/v2-qr-ph-upload.md:100-101`. The repo's own follow-up plan (`.scratch/plans/v2-qr-review-fixes.md:268`) already lists "verify the 5 MB limit is actually applied" as an open action item that was never closed.

Location: lib/storage.ts:34-39 (mint has no content-type/size constraint); dashboard config is external to the repo

Failure scenario, contingent on unverified config: if the bucket-level allowlist was never actually applied, an attacker (needs only their own session, not someone else's link) can mint a URL and PUT arbitrary bytes with an arbitrary `content-type` and size. If the allowlist *is* applied, impact is bounded to oversized-but-still-image uploads (worsening ticket 09-08's — the existing tracked quota-exhaustion ticket — size assumption). If it was never applied, content up to Vercel's irrelevant-here platform limits could be served back from the project's own domain (`https://<ref>.supabase.co/storage/v1/object/public/<bucket>/qr/<sid>/<uuid>.jpg`) with attacker-chosen `content-type`.

Severity is Low specifically because the exploit is gated on a control the team already specified but never confirmed — this is a verification item, not a demonstrated exploit.

Needs triage: check the Supabase dashboard's Storage bucket settings (file size limit, allowed MIME types) directly rather than assuming from the plan doc. If confirmed applied, downgrade/close this ticket. If not applied, apply it (dashboard config, not a code change) and consider whether the plan doc's other stated-but-unverified assumptions need the same check.

Found by: security-reviewer, holistic review (2026-08-28).
