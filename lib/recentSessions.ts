// Remembers sessions the user has visited on THIS device, so the home page can offer
// a "return to a past session" list without any login. Backed by localStorage.

// One remembered session: just enough to show a tappable row (id + display name).
export interface RecentSession {
  id: string;
  name: string;
}

// The single localStorage key everything here reads/writes — defined once so it can't drift.
const STORAGE_KEY = "divvy:recentSessions";

// Never keep more than this many; the list is a convenience, not an archive.
const MAX_RECENT = 10;

// Read the remembered sessions, newest-first. Returns [] on the server, if nothing's
// stored yet, or if the stored value is somehow corrupted (bad JSON / wrong shape).
export function getRecentSessions(): RecentSession[] {
  // localStorage doesn't exist during server-side render — bail out safely.
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    // Guard against a hand-edited/corrupted value that isn't the array we expect.
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed entries, in case an older/partial shape slipped in.
    return parsed.filter(
      (s): s is RecentSession =>
        s && typeof s.id === "string" && typeof s.name === "string",
    );
  } catch {
    return [];
  }
}

// Remember (or refresh) one session: moves it to the top and trims the list to MAX_RECENT.
export function saveRecentSession(id: string, name: string): void {
  if (typeof window === "undefined") return;
  const existing = getRecentSessions();
  // Drop any previous entry for this id so re-opening bumps it to the front instead of duplicating.
  const withoutThis = existing.filter((s) => s.id !== id);
  const next = [{ id, name }, ...withoutThis].slice(0, MAX_RECENT);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
