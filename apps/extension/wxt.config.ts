import { defineConfig } from "wxt";

export default defineConfig({
  modules: [],
  manifest: {
    name: "MeanTime",
    description:
      "Text-only micro-ads shown during AI wait time. You control them, and you keep 55% of the revenue.",
    version: "0.1.0",
    permissions: ["storage", "alarms", "idle"],
    host_permissions: [
      "https://api.meantime.example/*",
      "http://localhost:3001/*",
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src 'self' https://api.meantime.example http://localhost:3001",
    },
  },
});
