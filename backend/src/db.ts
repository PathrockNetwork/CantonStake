/**
 * Prisma client singleton.
 *
 * Uses the DATABASE_URL env var to connect to PostgreSQL.
 * Falls back to a local dev URL if not set.
 */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log:
    process.env.LOG_LEVEL === "debug"
      ? ["query", "info", "warn", "error"]
      : ["warn", "error"],
});