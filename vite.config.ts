import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Puerto fijo: tauri.conf.json (devUrl) apunta a él.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // Vite no debe vigilar el código Rust: los .exe de target/ bloqueados por Windows lo hacían caer (EBUSY).
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
