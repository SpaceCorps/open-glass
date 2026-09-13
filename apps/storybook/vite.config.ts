import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3000,
  },
  resolve: {
    alias: {
      "@open-glass/core/wasm": path.resolve(
        __dirname,
        "../../packages/core/dist/wasm/open_glass_core.js",
      ),
      "@open-glass/core": path.resolve(__dirname, "../../packages/core/src/ts/index.ts"),
      "@open-glass/react": path.resolve(__dirname, "../../packages/react/src/index.ts"),
    },
  },
});
