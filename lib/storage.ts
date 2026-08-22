import "server-only"; // build-time guard: importing this from client code is a compile error, not a leaked key
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Reuse one Supabase client across dev HMR reloads, same globalThis pattern as lib/db.ts
const globalForSupabase = globalThis as unknown as { supabaseStorage?: ReturnType<typeof createClient> };

// auth options disabled — this client only ever talks to Storage with the service-role/secret key,
// never manages a user session, so Supabase's session-persistence machinery would be dead weight
const client =
  globalForSupabase.supabaseStorage ??
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

if (process.env.NODE_ENV !== "production") globalForSupabase.supabaseStorage = client;

const bucket = client.storage.from(process.env.SUPABASE_STORAGE_BUCKET!);

// Folder prefix for QR objects in this session: "<env-prefix>qr/<sessionId>/". The one place this
// string is built, so the upload route's path-ownership check (PUT can't be pointed at another
// session's object) and the mint below can never drift apart.
//
// Defaults to "" when SUPABASE_STORAGE_PREFIX is absent or blank — Vercel Production deliberately
// has no value set for this var (rather than an explicit empty string, which its dashboard makes
// awkward to configure), so "unset" must resolve the same way "" would.
export function qrObjectPrefix(sessionId: string): string {
  const envPrefix = process.env.SUPABASE_STORAGE_PREFIX || "";
  return `${envPrefix}qr/${sessionId}/`;
}

// Mint a signed upload URL for a new QR image. Always a fresh UUID + .jpg — the upload pipeline
// (lib/imageCompress.ts) always outputs JPEG, so there's no client-supplied extension to trust.
export async function createQrUploadUrl(sessionId: string): Promise<{ path: string; signedUrl: string }> {
  const path = `${qrObjectPrefix(sessionId)}${randomUUID()}.jpg`;
  const { data, error } = await bucket.createSignedUploadUrl(path, { upsert: false });
  if (error) throw error;
  return { path: data.path, signedUrl: data.signedUrl };
}

// Delete one object — used when a participant replaces or removes their QR code, so the old
// object doesn't sit in Storage forever counting against the free-tier 1 GB cap
export async function deleteStorageObject(path: string): Promise<void> {
  const { error } = await bucket.remove([path]);
  if (error) throw error;
}

// Best-effort delete: never throws, and gives up after timeoutMs so a hung Storage call can't
// block a caller's HTTP response beyond that bound. Used by the QR replace/remove routes, where
// the object being deleted is already unreferenced by the DB row — an orphaned object is the
// accepted failure mode (see CLAUDE.md's V2 constraints), but an unbounded response time is not.
export async function deleteStorageObjectBestEffort(path: string, timeoutMs = 8000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Storage delete timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    await Promise.race([deleteStorageObject(path), timeout]);
  } catch (err) {
    console.error("Best-effort Storage delete failed", path, err);
  } finally {
    clearTimeout(timer);
  }
}
