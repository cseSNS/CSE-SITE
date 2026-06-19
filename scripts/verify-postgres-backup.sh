#!/usr/bin/env sh
set -eu

ARCHIVE="${1:?Usage: sh scripts/verify-postgres-backup.sh backups/cse-postgres-YYYYMMDD-HHMMSS.sql.gz}"
NAME="cse-postgres-restore-$$"
PASSWORD="restore-check"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB=cse_restore postgres:16-alpine >/dev/null
until docker exec "$NAME" pg_isready -U postgres -d cse_restore >/dev/null 2>&1; do sleep 1; done

gzip -cd "$ARCHIVE" | docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -U postgres -d cse_restore >/dev/null
docker exec "$NAME" psql -U postgres -d cse_restore -Atc "SELECT 'ok:' || count(*) FROM information_schema.tables WHERE table_name IN ('ideas','admin_accounts','site_documents')" | grep -q '^ok:3$'

echo "Restore verification passed: $ARCHIVE"
