#!/usr/bin/env bash
# Runs the real F# Vitium client against the real machine-intake handler over loopback HTTPS.
# Requires node >= 22, dotnet 10 and openssl. Creates only temporary files.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d)"
cleanup() { [ -n "${server_pid:-}" ] && kill "$server_pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1" -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
fingerprint="$(openssl x509 -in "$work/cert.pem" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':')"

node "$root/tests/interop/machine-intake-server.mjs" "$work/cert.pem" "$work/key.pem" > "$work/server.out" &
server_pid=$!
for _ in $(seq 1 50); do grep -q port "$work/server.out" 2>/dev/null && break; sleep 0.1; done
port="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).port)' "$work/server.out")"

VITIUM_INTEROP_URL="https://127.0.0.1:$port" VITIUM_INTEROP_CERT_SHA256="$fingerprint" \
  dotnet run --project "$root/tests/Vitium.Interop/Vitium.Interop.fsproj" -c Release
