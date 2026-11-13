import { createServer } from "node:http";
import { closeSync, createReadStream, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { buildBoardData, buildEvidencePage, buildPage, readRuns, requestRefreshFor } from "./board.mts";
import { executeRefresh } from "./refresh-worker.mts";

// Always-on board: GET / renders the page from the shared state dir on every request.
// GET /api/runs returns the same run snapshot as uncached JSON; the page polls it every 10s (read-only).
// GET /evidence/<run-key>/ uses the board shell with image/video/text previews and back navigation.
// GET /evidence/<run-key>/<file> serves originals. Text previews are bounded to 64 KiB.
// POST /api/refresh/<run-key> (header x-factory-refresh: 1, which a cross-site page cannot send) starts a read-only
// worker to recheck that ticket (#78), even with scheduling off. It runs only the project's bounded --refresh-only
// command, never ticket work. The server stays tracker-agnostic; missing roots and command failures are recorded.
// Run directly: node board-server.mts   (Node 22.18+; no build step)
// Env: PORT (default 4444), HOST (default 127.0.0.1), SANDCASTLE_STATE_DIR.

const PORT = Number(process.env.PORT || 4444);
const HOST = process.env.HOST || "127.0.0.1";
const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".webm": "video/webm", ".mp4": "video/mp4",
  ".md": "text/plain; charset=utf-8", ".json": "application/json", ".php": "text/plain; charset=utf-8",
  ".cjs": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".log": "text/plain; charset=utf-8",
};
function previewText(file: string): string {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", "http://x");
    const refresh = /^\/api\/refresh\/([^/]+)$/.exec(url.pathname);
    if (refresh) {
      if (req.method !== "POST" || req.headers["x-factory-refresh"] !== "1") {
        res.writeHead(405, { "content-type": "text/plain", allow: "POST" });
        return void res.end("POST with x-factory-refresh: 1");
      }
      const key = decodeURIComponent(refresh[1]);
      requestRefreshFor(key);
      void executeRefresh(key);
      res.writeHead(202, { "content-type": "application/json", "cache-control": "no-store" });
      return void res.end('{"requested":true}');
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return void res.end(buildPage("http"));
    }
    if (url.pathname === "/api/runs") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return void res.end(JSON.stringify(buildBoardData("http")));
    }
    const m = /^\/evidence\/([^/]+)\/(.*)$/.exec(url.pathname);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const run = readRuns().find((r) => r.key === key);
      if (!run?.evidenceDir || !existsSync(run.evidenceDir)) throw new Error("not found");
      const name = decodeURIComponent(m[2]);
      if (!name) {
        const items = readdirSync(run.evidenceDir, { withFileTypes: true })
          .filter((f) => !f.name.startsWith(".") && f.isFile()).sort((a, b) => a.name.localeCompare(b.name))
          .map(({ name }) => {
            const file = resolve(run.evidenceDir!, name);
            const type = TYPES[extname(name).toLowerCase()] || "";
            const kind = type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : type.startsWith("text/") || type === "application/json" ? "text" : "file";
            return { name, kind, url: `/evidence/${encodeURIComponent(key)}/${encodeURIComponent(name)}`,
              ...(kind === "text" ? { text: previewText(file), truncated: statSync(file).size > 64 * 1024 } : {}) };
          });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return void res.end(buildEvidencePage(run, items));
      }
      const file = resolve(run.evidenceDir, basename(name)); // basename: files directly in the folder only
      if (!existsSync(file) || !statSync(file).isFile()) throw new Error("not found");
      res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "content-length": statSync(file).size });
      return void createReadStream(file).pipe(res);
    }
    throw new Error("not found");
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});
server.listen(PORT, HOST, () => {
  const address = server.address();
  console.log(`Sandcastle board at http://${HOST}:${typeof address === "object" && address ? address.port : PORT}`);
});
