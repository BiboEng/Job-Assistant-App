import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api to the Express backend so there's no CORS fuss in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
