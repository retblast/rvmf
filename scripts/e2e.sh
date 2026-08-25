#!/usr/bin/env bash
# Full E2E chain: throwaway Postgres -> Mitra server -> seeded data ->
# production build under `vite preview` -> Playwright.
#
# Everything is hermetic: a temp dir per run, torn down on exit.
#
# Requirements:
#   - postgres tools (initdb/pg_ctl/psql) on PATH (in the dev shell)
#   - MITRA_BIN pointing at a Mitra server binary; defaults to the
#     flake-built one when available.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d /tmp/rvmf-e2e.XXXXXX)"
# Ports are randomized per run — a lingering server from an earlier
# attempt can't wedge the next one. Override via env if you must.
PGPORT="${PGPORT:-$((20000 + RANDOM % 20000))}"
MITRAPORT="${MITRAPORT:-$((40000 + RANDOM % 10000))}"
PREVIEWPORT="${PREVIEWPORT:-$((31000 + RANDOM % 8000))}"

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  [[ -n "${PREVIEW_PID:-}" ]] && kill "$PREVIEW_PID" 2>/dev/null || true
  [[ -n "${PG_PID:-}" ]] && "$PG_CTL" -D "$WORK/pg" -m fast stop >/dev/null 2>&1 || true
  # RVMF_KEEP=1 preserves logs for debugging
  [[ "${RVMF_KEEP:-}" == 1 ]] || rm -rf "$WORK"
}
trap cleanup EXIT

echo "== e2e workspace: $WORK"

# --- Mitra binary ---
if [[ -z "${MITRA_BIN:-}" ]]; then
  MITRA_BIN="$ROOT/result/bin/mitra"
  if [[ ! -x "$MITRA_BIN" ]]; then
    echo "Building mitra via flake..."
    (cd "$ROOT" && nix build .#mitra)
  fi
fi
echo "== using mitra: $MITRA_BIN"
"$MITRA_BIN" --version || true

# --- Postgres ---
INITDB="$(command -v initdb)"
PG_CTL="$(command -v pg_ctl)"
export PGDATA="$WORK/pg"
# Socket goes in the workspace — /run/postgresql isn't ours to write.
"$INITDB" --auth=trust -U postgres > "$WORK/initdb.log" 2>&1 \
  || { cat "$WORK/initdb.log"; exit 1; }
"$PG_CTL" -w -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$WORK" start \
  > "$WORK/pgctl.log" 2>&1 \
  || { cat "$WORK/pgctl.log"; cat "$WORK"/pg/logfile* 2>/dev/null; exit 1; }
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -q \
  -c "CREATE USER mitra WITH PASSWORD 'mitra' SUPERUSER" \
  -c "CREATE DATABASE mitra OWNER mitra"

# --- Mitra config + server ---
# Start from the vendored upstream example (strict config schema) and
# patch in the fixture values.
mkdir -p "$WORK/storage" "$WORK/webclient"
sed -e "s|^database_url: .*|database_url: postgres://mitra:mitra@127.0.0.1:$PGPORT/mitra|" \
    -e "s|^storage_dir: .*|storage_dir: $WORK/storage|" \
    -e "s|^web_client_dir: .*|web_client_dir: $WORK/webclient|" \
    -e "s|^http_port: .*|http_port: $MITRAPORT|" \
    -e "s|^instance_url: .*|instance_url: http://127.0.0.1:$MITRAPORT|" \
    -e "s|^  type: invite|  type: open|" \
    "$ROOT/scripts/mitra.config.example.yaml" > "$WORK/config.yaml"

CONFIG_PATH="$WORK/config.yaml" "$MITRA_BIN" server > "$WORK/mitra.log" 2>&1 &
SERVER_PID=$!

for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$MITRAPORT/api/v1/instance" > /dev/null; then break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || { cat "$WORK/mitra.log"; exit 1; }
  sleep 0.5
done
echo "== mitra up on :$MITRAPORT"

# Create users via the CLI — the HTTP registration endpoint is
# rate-limited, and the CLI writes straight to the database.
for USER in alice bob carol; do
  CONFIG_PATH="$WORK/config.yaml" "$MITRA_BIN" create-account "$USER" password-123 user \
    || echo "user $USER may already exist"
done

# --- Seed data through our own API client ---
(cd "$ROOT" && node scripts/seed.mjs "http://127.0.0.1:$MITRAPORT")

# --- Production build under preview ---
(cd "$ROOT" && npm run build > /dev/null)
(cd "$ROOT" && npx vite preview --host 127.0.0.1 --port $PREVIEWPORT --strictPort) > "$WORK/preview.log" 2>&1 &
PREVIEW_PID=$!
for i in $(seq 1 20); do
  curl -sf http://127.0.0.1:$PREVIEWPORT/ > /dev/null && break
  sleep 0.5
done
echo "== preview up on :$PREVIEWPORT"

# --- Playwright ---
if [[ "${SKIP_TESTS:-}" != 1 ]]; then
  (cd "$ROOT" && E2E_PREVIEW_PORT=$PREVIEWPORT E2E_INSTANCE="http://127.0.0.1:$MITRAPORT" npx playwright test "$@")
fi

# Debug hook: hold the stack open for manual probing.
if [[ -n "${E2E_HOLD:-}" ]]; then
  echo "== holding stack for ${E2E_HOLD}s (mitra :$MITRAPORT, preview :$PREVIEWPORT)"
  sleep "$E2E_HOLD"
fi
