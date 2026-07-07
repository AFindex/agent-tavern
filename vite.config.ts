import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true,
      },
      "/st-public": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/scripts": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/script.js": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/lib.js": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/version": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
