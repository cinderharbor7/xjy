import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
// Test/preview isolation avoids loading private production configuration or state.
if (process.env.XJY_ISOLATED_PREVIEW !== "1") {
  const inherited = { ...process.env };
  for (const file of [".env", ".env.local"])
    if (existsSync(file)) process.loadEnvFile(file);
  Object.assign(process.env, inherited);
} else {
  if (!process.env.GUARDIAN_DB_PATH)
    throw new Error("Isolated preview requires a separate database path.");
  process.env.GUARDIAN_MODE = "MOCK";
  process.env.MOCK_MODE = "true";
}
const portArgument = process.argv.indexOf("--port");
const port = Number(
  portArgument >= 0 ? process.argv[portArgument + 1] : process.env.PORT || 3000,
);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid port");
process.env.GUARDIAN_ORIGIN ??= `http://localhost:${port}`;
const { dispatchApi } = await import("./api");
const { getGuardian } = await import("../src/integration/guardian/runtime");
const production = process.argv.includes("--production");
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({ server: { middlewareMode: true }, appType: "spa" });
const publicRoutes =
  /^\/(?:coins\/[A-Za-z0-9-]+|guardian|investigate|risk-lab|position|attestations|collection)?\/?$/;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? `127.0.0.1:${port}`}`,
    );
    if (url.pathname.startsWith("/api/")) {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 1_000_000) {
          res.writeHead(413);
          res.end("Request too large");
          return;
        }
        chunks.push(chunk);
      }
      const request = new Request(url, {
        method: req.method,
        headers,
        ...(!["GET", "HEAD"].includes(req.method ?? "GET")
          ? { body: Buffer.concat(chunks) }
          : {}),
      });
      const response = await dispatchApi(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!["GET", "HEAD"].includes(req.method ?? "")) {
      res.writeHead(405);
      res.end();
      return;
    }
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const base = resolve(root, "dist");
    const path = resolve(
      base,
      "." +
        (publicRoutes.test(url.pathname)
          ? "/index.html"
          : decodeURIComponent(url.pathname)),
    );
    if (!path.startsWith(base + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const content = await readFile(path);
      res.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json",
            ".svg": "image/svg+xml",
          }[extname(path)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Request failed. Check the local server." }),
    );
  }
});
// Bind first: a second process must not start monitoring before discovering a busy port.
server.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
  void vite?.close();
});
server.listen(port, "127.0.0.1", () => {
  try {
    getGuardian().startLoop();
    console.log(
      `VERDANT: http://127.0.0.1:${port} (${process.env.XJY_ISOLATED_PREVIEW === "1" ? "isolated MOCK state" : "configured Guardian state"})`,
    );
  } catch {
    console.error(
      "Guardian startup rejected the saved state/configuration. No state was reset.",
    );
    server.close();
    void vite?.close();
    process.exitCode = 1;
  }
});
const shutdown = () => {
  getGuardian().stopLoop();
  server.close();
  void vite?.close();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
