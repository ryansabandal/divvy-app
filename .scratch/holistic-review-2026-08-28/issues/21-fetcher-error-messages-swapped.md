Status: fix-on-touch (was: ready-for-agent)
Severity: Low
Category: Best-Practice

# `fetcher` error messages are swapped in both settle and view pages

`lib/fetcher.ts`'s stated purpose is a per-page-parameterized error message so a fetch failure shows the right context. Both pages that make two independent SWR fetches pass the wrong message to one of them:

- `app/[sessionId]/settle/page.tsx:26-27` — the **session** fetch (`/api/sessions/:id`) is given `"Failed to load settlements"`.
- `app/[sessionId]/view/page.tsx:29-30` — the **settlements** fetch (`/api/sessions/:id/settlements`) is given `"Failed to load session"`.

Location: app/[sessionId]/settle/page.tsx:26-27; app/[sessionId]/view/page.tsx:29-30

Failure scenario: if the settlements endpoint fails on the view page (or the session endpoint fails on the settle page), the user sees an error message describing the wrong resource — defeating the entire documented reason the fetcher's message argument is parameterized per call site instead of being one generic string.

Fix: swap each mislabeled string to match the endpoint it's actually attached to.

Found by: best-practice-reviewer, holistic review (2026-08-28); confirmed by Claude reading both files directly.
