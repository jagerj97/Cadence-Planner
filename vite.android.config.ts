import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

// The app version shown in Settings lives in package.json.
const { version } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "android/app/src/main/assets/web"),
    emptyOutDir: true,
    // One bundle loaded from inside the APK, so the web download-size warning doesn't apply.
    chunkSizeWarningLimit: 1000,
    rollupOptions: { input: path.resolve(import.meta.dirname, "client/android.html") },
  },
});
