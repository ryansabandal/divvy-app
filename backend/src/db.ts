import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Driver adapter wraps the `pg` pool so PrismaClient can talk to Postgres without the Rust query engine
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Single shared PrismaClient instance for the whole app
export const prisma = new PrismaClient({ adapter });
