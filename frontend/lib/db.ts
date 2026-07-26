import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Reuse one PrismaClient across dev HMR reloads via globalThis — without this, every hot reload
// creates a fresh client (and a fresh pg pool) that's never torn down, exhausting connections
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Driver adapter wraps the `pg` pool so PrismaClient can talk to Postgres without the Rust query engine.
// max: 1 — each serverless function instance gets its own pool; Supabase's transaction-mode
// pooler (port 6543) is what actually multiplexes connections across instances, not this pool
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 });

// Single shared PrismaClient instance for the whole app
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
