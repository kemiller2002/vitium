// Interop harness only: serves the real machine HTTP handler over HTTPS on loopback so the real
// EchelonFoundry.Vitium.Client can be exercised end to end. Test credentials map to fixed claims;
// a production deployment would verify signed workload tokens instead. Never deploy this file.
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { makeMachineIntake } from "../../service/machine-intake.mjs";
import { createMachineHttpHandler } from "../../service/machine-http.mjs";
import { defineBinding } from "../../service/machine-auth.mjs";
import { eventTypes } from "../../service/machine-observation.mjs";

const [certPath, keyPath] = process.argv.slice(2);
const records = new Map();
const store = Object.freeze({
  async putOnce(item) {
    if (records.has(item.pk)) return { created: false, existing: records.get(item.pk) };
    records.set(item.pk, item);
    return { created: true };
  }
});
const bindings = [
  defineBinding({ subject: "interop:praxis", system: "praxis", repositories: ["kemiller2002/summa"], environments: ["ci"], eventTypes: [...eventTypes] }),
  defineBinding({ subject: "interop:other", system: "praxis", repositories: ["kemiller2002/other"], environments: ["ci"], eventTypes: ["observation.detected"] })
];
const subjects = { "interop-praxis-token-0001": "interop:praxis", "interop-other-token-00001": "interop:other" };
const verifyWorkloadToken = async token => {
  const sub = subjects[token];
  const iat = Math.floor(Date.now() / 1000) - 30;
  return sub ? { sub, iat, exp: iat + 600, jti: "interop-" + token.slice(-4) } : null;
};
const handle = createMachineHttpHandler(makeMachineIntake({ store, verifyWorkloadToken, bindings }));

const readBody = request => new Promise((resolve, reject) => {
  const chunks = [];
  request.on("data", chunk => chunks.push(chunk)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))).on("error", reject);
});
const server = createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, async (request, response) => {
  const path = new URL(request.url, "https://localhost").pathname;
  if (request.method === "GET" && path === "/__interop/stats") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ stored: records.size, kinds: [...records.values()].map(item => item.kind).sort() }));
    return;
  }
  const reply = await handle({
    rawPath: path, requestContext: { http: { method: request.method }, requestId: "interop" },
    headers: request.headers, body: await readBody(request)
  });
  response.writeHead(reply.statusCode, reply.headers);
  response.end(reply.body);
});
server.listen(0, "127.0.0.1", () => process.stdout.write(JSON.stringify({ port: server.address().port }) + "\n"));
