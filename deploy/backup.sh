#!/usr/bin/env bash
# Backs up the selected database to <dir>/gachipad-<time>.archive.gz.
#
#   ./backup.sh [dir]        default dir: ./backups
#
# Valkey (join codes, presence, grants, bans, counters) is not part of the backup. The archive holds
# edit keys, PIN hashes and addresses: it is written 0600 into a directory created 0700.
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

database_backup "${1:-./backups}"
