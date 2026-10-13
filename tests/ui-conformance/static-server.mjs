// Minimal dependency-free static server for the UI conformance suite.
// Serves only files inside --root; rejects traversal; no directory listing.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const port = Number(arg("port") ?? 4180);
const root = resolve(arg("root") ?? "site");
const TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
});

const resolveRequest = async url => {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const candidate = resolve(join(root, normalize(pathname)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  const info = await stat(candidate).catch(() => null);
  if (info?.isDirectory()) return join(candidate, "index.html");
  return info?.isFile() ? candidate : null;
};

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const file = await resolveRequest(request.url ?? "/").catch(() => null);
  const body = file ? await readFile(file).catch(() => null) : null;
  if (!body) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  response.end(request.method === "HEAD" ? undefined : body);
}).listen(port, "127.0.0.1", () => console.log(`ui-conformance static server: http://127.0.0.1:${port}/ (root ${root})`));
