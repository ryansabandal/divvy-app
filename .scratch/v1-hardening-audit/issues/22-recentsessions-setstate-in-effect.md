Status: backlog (not blocking V1 close)
Severity: Low
Category: Best-practice

# setState called synchronously in an effect on the home page

`app/page.tsx` — `useEffect(() => { setRecentSessions(getRecentSessions()); }, [])` trips ESLint's `react-hooks/set-state-in-effect` as an **error**, not a warning (the rest of the app deliberately avoids this pattern — it's the stated reason `lib/fetcher.ts`/SWR were adopted instead of `useEffect`+`useState` for data fetching, per the README's "Data fetching" section).

Pre-existing; not introduced by the 2026-07-19 ExpenseBreakdown work, just surfaced when running `npx eslint app lib components` to verify that feature's new files were clean.

**Update (2026-07-26, Phase 4 section B):** the lint error was suppressed with a scoped `eslint-disable-next-line react-hooks/set-state-in-effect` + explanatory comment, so `npm run lint` is currently clean — but the underlying pattern this ticket flags (`setState` in an effect instead of a lazy `useState` initializer) is unchanged. Still genuinely open.

Location: `app/page.tsx`, in the `recentSessions` `useEffect`.

Fix sketch: `getRecentSessions()` reads `localStorage`, so it can't run at module scope (SSR has no `window`) — but it can be called directly during render instead of via effect+setState, e.g. `const [recentSessions] = useState(() => typeof window !== "undefined" ? getRecentSessions() : [])`, or lazily on first client render. Check whether `recentSessions` needs to reflect *live* changes to `localStorage` after mount (e.g. another tab); if not, a lazy `useState` initializer is simplest and matches the no-effect pattern already used elsewhere.

Found during: verification pass for the per-person charge breakdown feature (commit not yet made as of filing), 2026-07-19.
