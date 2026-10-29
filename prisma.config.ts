import dotenv from "dotenv";
dotenv.config({ quiet: true });

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "src/prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL,
  },
});
