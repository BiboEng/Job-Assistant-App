import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api to the Express backend so there's no CORS fuss in dev.
export default defineConfig({
  plugins: [react()],
  // SUPABASE_URL / SUPABASE_ANON_KEY keep their plain names in client/.env
  // rather than a VITE_ prefix. Both are public by design (the anon key is
  // gated by Supabase row-level security, not by secrecy) — never add a
  // prefix here that could match a real secret, because every matching var
  // is bundled into the client.
  envPrefix: ["VITE_", "SUPABASE_"],
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
