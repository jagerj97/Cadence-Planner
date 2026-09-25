import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

// The app version lives in package.json; CI adds its run number as the build number.
const { version } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(process.env.GITHUB_RUN_NUMBER ?? ""),
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "android/app/src/main/assets/web"),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(import.meta.dirname, "client/android.html") },
  },
});
