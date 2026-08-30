import { NextResponse } from "next/server";
import type { z } from "zod";

// Parses the request body, treating an empty body as undefined rather than throwing so Zod can
// report it as a missing field. Malformed non-empty JSON throws — parseBody turns that into a 400.
async function parseJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  return text === "" ? undefined : JSON.parse(text);
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

// Every route handler needs the same parse-then-validate-then-400 sequence — one home for it
// instead of a repeated four-line block at every call site.
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<ParsedBody<T>> {
  let json: unknown;
  try {
    json = await parseJsonBody(request);
  } catch {
    // Unparseable body — reported separately from a schema failure, so the caller isn't told a
    // field is missing when the JSON itself is the problem
    return { ok: false, response: NextResponse.json({ error: "request body is not valid JSON" }, { status: 400 }) };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid request body";
    return { ok: false, response: NextResponse.json({ error: message }, { status: 400 }) };
  }
  return { ok: true, data: result.data };
}
