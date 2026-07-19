// Builds an absolute URL to the backend API from a path like "/api/sessions/123". One place
// to read NEXT_PUBLIC_API_URL instead of ~12 — it must include the https:// scheme or the
// browser resolves it as a relative path off the frontend's own origin (see CLAUDE.md).
export function apiUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_API_URL}${path}`;
}
