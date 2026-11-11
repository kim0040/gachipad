#!/usr/bin/env bash
# Restores a backup made by backup.sh. Replaces the current database contents.
#
#   ./restore.sh <archive.gz> [--yes]
set -euo pipefail
umask 077
cd "$(dirname "$0")"
. ./lib.sh
declare -F assert_readable_env >/dev/null || die 'lib.sh is older than this script'
assert_readable_env
assert_no_database_migration
need_docker
install_lock
trap install_unlock EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
assert_no_database_migration

ARCHIVE="${1:-}"
[ -n "$ARCHIVE" ] || die "usage: ./restore.sh <archive.gz> [--yes]"
[ -f "$ARCHIVE" ] || die "usage: ./restore.sh <archive.gz> [--yes]"
DB_KIND="$(database_kind)"
[ "$DB_KIND" != external ] || die "DATABASE_URL uses an external database; restore it with the external server's tools"
if [ "${2:-}" != "--yes" ]; then
  read -r -p "Replace the current gachipad database with $ARCHIVE? [y/N] " answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || die "cancelled"
fi

# api and collab write to the database; collab flushes open documents on stop.
gzip -t -- "$ARCHIVE" || die "invalid gzip archive; database unchanged"
database_validate "$ARCHIVE" || die "backup validation failed; database unchanged"
backup_space
stop_writes restore
database_start 120
database_restore "$ARCHIVE"
docker compose up -d --wait --wait-timeout 120 api collab
wait_api 120
docker compose up -d
wait_healthy 120
echo "restore: done"
