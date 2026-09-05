import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: `.env.${process.env.NODE_ENV ?? "development"}` });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
