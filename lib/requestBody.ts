import { NextResponse } from "next/server";
import type { z } from "zod";

// Mirrors express.json()'s behavior on an empty request body: yields undefined rather than
// throwing. Route Handlers' bare request.json() does a plain JSON.parse(text) with no such
// special case, so an empty body threw an uncaught SyntaxError -> uncaught 500, where Express
// left req.body undefined and let Zod's safeParse produce its normal clean 400 instead.
// Genuinely malformed (non-empty) JSON still throws here, same as Express — only the
// empty-body case is special-cased.
export async function parseJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  return text === "" ? undefined : JSON.parse(text);
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

// Every route handler needs the same parse-then-validate-then-400 sequence — one home for it
// instead of a repeated four-line block at every call site.
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<ParsedBody<T>> {
  const json = await parseJsonBody(request);
  const result = schema.safeParse(json);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid request body";
    return { ok: false, response: NextResponse.json({ error: message }, { status: 400 }) };
  }
  return { ok: true, data: result.data };
}
