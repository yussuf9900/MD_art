import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const key of [
    "MDART_LOCAL_DATA",
    "MDART_DATA_DIR",
    "ADMIN_USERNAME",
    "ADMIN_INITIAL_PASSWORD",
    "SESSION_SECRET",
    "APP_ORIGIN",
    "BLOB_PRIVATE_READ_WRITE_TOKEN",
    "BLOB_PUBLIC_READ_WRITE_TOKEN",
    "VERCEL_ANALYTICS_TOKEN",
    "VERCEL_ANALYTICS_PROJECT_ID",
    "VERCEL_ANALYTICS_TEAM_ID",
    "ANALYTICS_CUSTOM_EVENTS",
  ])
    if (env[key] !== undefined) process.env[key] = env[key];
  return {
    build: {
      rollupOptions: {
        input: { main: resolve("index.html"), admin: resolve("admin.html") },
      },
    },
    plugins: [
      {
        name: "mdart-local-api",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (
              req.url.split("?")[0] === "/admin" ||
              req.url.split("?")[0] === "/admin/"
            )
              req.url = "/admin.html";
            if (!req.url.startsWith("/api/")) return next();
            const { default: handler } = await import("./server/handler.js");
            await handler(req, res);
          });
        },
      },
    ],
  };
});
