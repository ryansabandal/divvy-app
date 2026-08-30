import { Prisma } from "@prisma/client";

// True when Prisma failed because the target row is gone (P2025). Returns a boolean rather than a
// response — the right status differs by route.
export function isMissingRowError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}
