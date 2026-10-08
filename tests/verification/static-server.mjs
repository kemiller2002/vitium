#!/usr/bin/env node
// Minimal dependency-free static server for browser verification of site/.
// Pure path/type resolution is separated from the single network effect.
// Mirrors GitHub Pages closely enough for the static reporter: no CSP header
// (the page carries its own meta CSP), no directory listing, no traversal.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
});

export const contentTypeFor = path => TYPES[extname(path).toLowerCase()] ?? null;

/** Pure: map a request path to a file under root, refusing traversal and unknown types. */
export function resolveSitePath(root, rawUrl) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(rawUrl, "http://local.invalid").pathname); }
  catch { return { ok: false, error: { status: 400, reason: "bad-path" } }; }
  if (pathname.includes("\0")) return { ok: false, error: { status: 400, reason: "bad-path" } };
  const relative = pathname.endsWith("/") ? pathname + "index.html" : pathname;
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, "." + relative);
  if (target !== absoluteRoot && !target.startsWith(absoluteRoot + sep)) {
    return { ok: false, error: { status: 403, reason: "outside-root" } };
  }
  const type = contentTypeFor(target);
  if (!type) return { ok: false, error: { status: 404, reason: "unknown-type" } };
  return { ok: true, value: { file: target, type } };
}

/** Effect boundary: start serving. Resolves to {ok,value:{url,close}} or {ok:false,error}. */
export function startStaticServer({ root, port = 0, host = "127.0.0.1", read = readFile } = {}) {
  const server = createServer(async (req, res) => {
    const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, headers).end();
      return;
    }
    const resolved = resolveSitePath(root, req.url ?? "/");
    if (!resolved.ok) { res.writeHead(resolved.error.status, headers).end(); return; }
    try {
      const body = await read(resolved.value.file);
      res.writeHead(200, { ...headers, "content-type": resolved.value.type });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, headers).end();
    }
  });
  return new Promise(done => {
    server.once("error", error => done({ ok: false, error }));
    server.listen(port, host, () => {
      const { port: bound } = server.address();
      done({
        ok: true,
        value: {
          url: `http://${host}:${bound}/`,
          close: () => new Promise(r => server.close(() => r()))
        }
      });
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = name => {
    const hit = process.argv.find(x => x.startsWith("--" + name + "="));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const root = arg("root") ?? fileURLToPath(new URL("../../site/", import.meta.url));
  const result = await startStaticServer({ root, port: Number(arg("port") ?? 4173) });
  if (!result.ok) {
    process.stderr.write("static server failed: " + result.error.message + "\n");
    process.exit(1);
  }
  process.stdout.write("Serving " + root + " at " + result.value.url + "\n");
}
