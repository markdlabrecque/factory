import { createServer } from "node:http";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { buildPage, readRuns } from "./board.mts";

// Always-on board: GET / renders the page from the shared state dir on every request.
// GET /evidence/<run-key>/[file] serves files from that run's evidence folder (screenshots, video).
// Run directly: node board-server.mts   (Node 22.18+; no build step)
// Env: PORT (default 4444), HOST (default 127.0.0.1), SANDCASTLE_STATE_DIR.

const PORT = Number(process.env.PORT || 4444);
const HOST = process.env.HOST || "127.0.0.1";
const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".webm": "video/webm", ".mp4": "video/mp4",
  ".md": "text/plain; charset=utf-8", ".json": "application/json", ".php": "text/plain; charset=utf-8",
  ".cjs": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".log": "text/plain; charset=utf-8",
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", "http://x");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return void res.end(buildPage("http"));
    }
    const m = /^\/evidence\/([^/]+)\/(.*)$/.exec(url.pathname);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const run = readRuns().find((r) => r.key === key);
      if (!run?.evidenceDir || !existsSync(run.evidenceDir)) throw new Error("not found");
      const name = decodeURIComponent(m[2]);
      if (!name) {
        const items = readdirSync(run.evidenceDir).filter((f) => !f.startsWith(".")).sort();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return void res.end(`<!doctype html><meta charset="utf-8"><title>Evidence ${esc(key)}</title><h1>Evidence ${esc(key)}</h1><ul>${items.map((f) => `<li><a href="${encodeURIComponent(f)}">${esc(f)}</a></li>`).join("")}</ul>`);
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
}).listen(PORT, HOST, () => console.log(`Sandcastle board at http://${HOST}:${PORT}`));
