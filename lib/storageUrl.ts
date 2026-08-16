// Builds a public Supabase Storage URL from an object path — deterministic string construction,
// no Supabase client, no secret key. Kept separate from lib/storage.ts so serialize.ts can derive
// a participant's qr_code_url without importing the service-role client into that module's graph.
export function publicObjectUrl(path: string): string {
  const base = process.env.SUPABASE_URL!;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET!;
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}
