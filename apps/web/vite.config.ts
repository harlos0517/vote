import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, normalize } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Dev/preview only: serve the ETL output (data/out) at /data so the app can run
 * against a locally built release without R2. Production reads VITE_DATA_BASE_URL.
 */
function localData(): Plugin {
  const root = resolve(import.meta.dirname, "../../data/out");
  const handler = (req: { url?: string }, res: any, next: () => void) => {
    const url = (req.url ?? "").split("?")[0]!;
    if (!url.startsWith("/data/")) return next();
    const file = normalize(resolve(root, "." + decodeURIComponent(url.slice("/data".length))));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end("not found");
    }
    res.setHeader("Content-Type", file.endsWith(".json") || file.endsWith(".geojson") ? "application/json" : "application/octet-stream");
    createReadStream(file).pipe(res);
  };
  return {
    name: "local-data",
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}

export default defineConfig({
  // GitHub Pages serves from /<repo>/; the deploy workflow sets VITE_BASE.
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), localData()],
});
