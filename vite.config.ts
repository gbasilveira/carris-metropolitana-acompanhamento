import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api/google": "http://localhost:8787" } },
  test: { include: ["src/**/*.test.ts", "server/**/*.test.ts"] },
});
