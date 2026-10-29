import { availableParallelism } from "node:os";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: availableParallelism() * 2 + 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 300_000,
});

const db = new PrismaClient({ adapter });

export default db;
