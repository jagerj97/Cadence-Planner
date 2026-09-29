import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import android from "./vite.android.config";

// The web version for GitHub Pages: the same app as the APK, built from client/index.html into dist/web.
export default mergeConfig(android, defineConfig({
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/web"),
    rollupOptions: { input: path.resolve(import.meta.dirname, "client/index.html") },
  },
}));
