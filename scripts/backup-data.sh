#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
CONTAINER="${CONTAINER:-cse-site}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
docker cp "$CONTAINER:/data" "$BACKUP_DIR/cse-data-$STAMP"
tar -czf "$BACKUP_DIR/cse-data-$STAMP.tar.gz" -C "$BACKUP_DIR" "cse-data-$STAMP"
rm -rf "$BACKUP_DIR/cse-data-$STAMP"

echo "$BACKUP_DIR/cse-data-$STAMP.tar.gz"
