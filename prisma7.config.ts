import { config } from "dotenv";
config();
import { defineConfig } from "@prisma/config";

const isProduction = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL && isProduction) {
  throw new Error("DATABASE_URL must be configured for production Prisma commands.");
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:./prisma/dev.db";
}

if (isProduction && process.env.DATABASE_URL.startsWith("file:")) {
  throw new Error("Production Prisma commands require a PostgreSQL DATABASE_URL; SQLite is local-only.");
}

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});