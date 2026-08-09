#!/usr/bin/env bash
# Hilo · backup script
# Creates a timestamped snapshot of the SQLite database (consistent, online)
# and the uploads directory. Safe to run while the service is live.
#
# Usage:
#   scripts/backup.sh [output-dir]
#
# Defaults:
#   APP_DIR     /opt/hilo (override with HILO_APP_DIR)
#   OUT_DIR     ./backups (override via argv[1] or HILO_BACKUP_DIR)
#   RETENTION   30 days   (override with HILO_BACKUP_KEEP_DAYS)
#
# Crontab example (daily at 03:15):
#   15 3 * * * /opt/hilo/scripts/backup.sh /var/backups/hilo

set -euo pipefail

APP_DIR="${HILO_APP_DIR:-/opt/hilo}"
OUT_DIR="${1:-${HILO_BACKUP_DIR:-./backups}}"
KEEP_DAYS="${HILO_BACKUP_KEEP_DAYS:-30}"

DB_PATH="${HILO_DATABASE_PATH:-$APP_DIR/data/hilo.db}"
UPLOADS_DIR="${HILO_UPLOADS_DIR:-$APP_DIR/uploads}"

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

# --- SQLite consistent snapshot via the .backup command (WAL-safe) ---
if [ -f "$DB_PATH" ]; then
  echo "[backup] sqlite → $OUT_DIR/hilo-${STAMP}.db"
  sqlite3 "$DB_PATH" ".backup '$OUT_DIR/hilo-${STAMP}.db'"

  # Verify the backup is actually readable before we trust it. A corrupt
  # backup is silent until restore time; one PRAGMA call after every
  # snapshot catches the vast majority of failure modes cheaply.
  INTEGRITY="$(sqlite3 "$OUT_DIR/hilo-${STAMP}.db" 'PRAGMA integrity_check;' 2>&1 || true)"
  if [ "$INTEGRITY" != "ok" ]; then
    echo "[backup] FATAL: integrity_check failed for hilo-${STAMP}.db: $INTEGRITY" >&2
    rm -f "$OUT_DIR/hilo-${STAMP}.db"
    exit 1
  fi
  echo "[backup] integrity ok"

  gzip -f "$OUT_DIR/hilo-${STAMP}.db"
else
  echo "[backup] warning: db file not found at $DB_PATH" >&2
fi

# --- Uploads tarball ---
if [ -d "$UPLOADS_DIR" ] && [ -n "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]; then
  echo "[backup] uploads → $OUT_DIR/uploads-${STAMP}.tgz"
  tar -C "$(dirname "$UPLOADS_DIR")" -czf "$OUT_DIR/uploads-${STAMP}.tgz" \
    "$(basename "$UPLOADS_DIR")"
else
  echo "[backup] info: no uploads to archive"
fi

# --- Retention sweep ---
if [ "$KEEP_DAYS" -gt 0 ]; then
  echo "[backup] pruning files older than ${KEEP_DAYS}d"
  find "$OUT_DIR" -type f \( -name 'hilo-*.db.gz' -o -name 'uploads-*.tgz' \) \
    -mtime "+${KEEP_DAYS}" -print -delete || true
fi

echo "[backup] done"
