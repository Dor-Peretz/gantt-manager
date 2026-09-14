import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ports are overridable so a demo run can sit next to a normal one.
const apiPort = Number(process.env.PORT || 8787);
const webPort = Number(process.env.WEB_PORT || 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
