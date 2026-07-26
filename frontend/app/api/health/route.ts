import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Health check that also confirms the DB connection is alive
export async function GET() {
  await prisma.$queryRaw`SELECT 1`;
  return NextResponse.json({ status: "ok" });
}
