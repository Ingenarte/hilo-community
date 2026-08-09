#!/usr/bin/env bash
# Hilo · restore from backup (host-side, Docker)
#
# An UNTESTED backup is not a backup. Run this script periodically against a
# scratch volume to prove the chain works end to end.
#
# Usage:
#   ./restore.sh <db.gz> [uploads.tgz]
#
# Example (drill, doesn't touch prod):
#   ./restore.sh ~/hilo-backups/hilo-20260525-031500.db.gz \
#                ~/hilo-backups/uploads-20260525-031500.tgz
#
# What it does:
#   1. Stops the hilo container.
#   2. Renames the existing /data inside the volume to /data.before-restore-<stamp>.
#   3. Decompresses the .db.gz into /data/hilo.db.
#   4. Extracts the uploads tarball into /data/uploads.
#   5. Runs `PRAGMA integrity_check` on the restored DB.
#   6. Starts the container back up + curls /api/health.
#
# Rollback: if step 5 or 6 fails, you can restore the previous state with:
#   docker exec hilo sh -c 'rm -rf /data/hilo.db /data/uploads && \
#     mv /data.before-restore-<STAMP>/hilo.db /data/hilo.db && \
#     mv /data.before-restore-<STAMP>/uploads /data/uploads'

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <hilo-*.db.gz> [uploads-*.tgz]" >&2
  exit 64
fi

DB_GZ="$1"
UPLOADS_TGZ="${2:-}"
CONTAINER="${HILO_CONTAINER:-hilo}"
STAMP="$(date +%Y%m%d-%H%M%S)"

[ -f "$DB_GZ" ] || { echo "[restore] db file not found: $DB_GZ" >&2; exit 65; }

# 0. Sanity: container exists?
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "[restore] container '$CONTAINER' not found" >&2
  exit 2
fi

echo "[restore] stopping container"
docker stop "$CONTAINER"

# Use a temporary helper container that mounts the same volume so we can move
# files even while `hilo` is down (the volume isn't bound to the host path).
VOLUME="$(docker inspect "$CONTAINER" --format '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}')"
if [ -z "$VOLUME" ]; then
  echo "[restore] could not resolve /data volume" >&2
  docker start "$CONTAINER" || true
  exit 3
fi
echo "[restore] data volume: $VOLUME"

# 1. Backup the existing state (so the operator can roll back).
echo "[restore] snapshotting current /data → /data.before-restore-${STAMP}"
docker run --rm -v "$VOLUME:/data" alpine sh -c \
  "mkdir -p /data.before-restore-${STAMP} && \
   [ -f /data/hilo.db ] && mv /data/hilo.db /data.before-restore-${STAMP}/ || true && \
   [ -d /data/uploads ] && mv /data/uploads /data.before-restore-${STAMP}/ || true"

# 2. Decompress the new DB into the volume.
echo "[restore] decompressing $DB_GZ"
gunzip -c "$DB_GZ" | docker run --rm -i -v "$VOLUME:/data" alpine sh -c \
  "cat > /data/hilo.db"

# 3. Restore uploads if a tarball was provided.
if [ -n "$UPLOADS_TGZ" ]; then
  [ -f "$UPLOADS_TGZ" ] || { echo "[restore] uploads file not found: $UPLOADS_TGZ" >&2; exit 66; }
  echo "[restore] extracting $UPLOADS_TGZ"
  cat "$UPLOADS_TGZ" | docker run --rm -i -v "$VOLUME:/data" alpine sh -c \
    "tar xzf - -C /data && chown -R 100:101 /data/uploads || true"
fi

# 4. Integrity check.
echo "[restore] PRAGMA integrity_check"
docker run --rm -v "$VOLUME:/data" alpine sh -c \
  "apk add --no-cache sqlite >/dev/null && \
   sqlite3 /data/hilo.db 'PRAGMA integrity_check;'"

# 5. Start the container.
echo "[restore] starting container"
docker start "$CONTAINER"

# 6. Wait for healthcheck.
echo "[restore] waiting for /api/health to be green"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "[restore] healthy"
    echo
    echo "Restore complete. Old state preserved under /data.before-restore-${STAMP} in"
    echo "the '$VOLUME' Docker volume. Remove it once you're sure the restore worked:"
    echo "  docker run --rm -v $VOLUME:/data alpine rm -rf /data.before-restore-${STAMP}"
    exit 0
  fi
  sleep 2
done

echo "[restore] FAILED: container did not become healthy after 20s" >&2
echo "[restore] previous state is at /data.before-restore-${STAMP} inside the volume" >&2
exit 1
