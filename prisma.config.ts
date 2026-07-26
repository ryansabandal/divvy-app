import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Connection used by Prisma CLI commands (migrate, studio, etc.)
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
