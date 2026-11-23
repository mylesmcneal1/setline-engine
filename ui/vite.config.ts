// set.Line UI. The pages are the approved mockups (plain JS); new code (the native bridge) is TypeScript.
// Release builds go to dist/, which CMake zips and embeds in the app. `npm run dev` serves the same
// pages on http://localhost:5173 for `setline --dev`.
import { defineConfig } from "vite";
import { resolve } from "node:path";

const page = (f: string) => resolve(import.meta.dirname, f);

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      // JUCE's helper uses eval only for Android user scripts; it's their code, vendored unchanged.
      onwarn(w, warn) { if (w.code === "EVAL" && String(w.id ?? "").includes("/juce/")) return; warn(w); },
      input: {
        arrange: page("1-arrange.html"),
        routing: page("2-routing.html"),
        satellite: page("3-satellite.html"),
        users: page("4-users.html"),
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
