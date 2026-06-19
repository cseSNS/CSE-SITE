#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DB_CONTAINER="${DB_CONTAINER:-cse-postgres}"
DB_NAME="${POSTGRES_DB:-cse}"
DB_USER="${POSTGRES_USER:-cse}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_DIR/cse-postgres-$STAMP.sql"
gzip -f "$BACKUP_DIR/cse-postgres-$STAMP.sql"

echo "$BACKUP_DIR/cse-postgres-$STAMP.sql.gz"
