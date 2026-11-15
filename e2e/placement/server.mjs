// Tiny static server for the placement harness (serves
// e2e/placement/dist/ on 127.0.0.1, ephemeral port). Prints
// `PLACEMENT_SERVER_PORT=<port>` on stdout once listening; the spec
// reads it and navigates there. No other routes: the harness mock
// (mock.js) answers every /api/* call in the page.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    let pathname = url.pathname === "/" ? "/readiness.html" : url.pathname;
    const file = path.join(distDir, decodeURIComponent(pathname));
    if (!file.startsWith(distDir)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(0, "127.0.0.1", () => {
  console.log(`PLACEMENT_SERVER_PORT=${server.address().port}`);
});
