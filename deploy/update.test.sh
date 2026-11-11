#!/usr/bin/env bash
# Tests deploy/update.sh against a fake release server and a fake docker:
#   bash deploy/update.test.sh
# Covers --check, refused major and downgrade, checksum and digest mismatches, the happy path,
# rollback after a failed health check, --auto with its policy, and the timer (systemd, cron, dry run).
# Needs python3 (the HTTP server) and curl.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
F="$(mktemp -d)"
server=""
cleanup() {
  [ -n "$server" ] && kill "$server" 2>/dev/null
  rm -rf "$F"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
ok() { printf 'ok: %s\n' "$*"; }
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  [ -f "$F/run.log" ] && tail -20 "$F/run.log" >&2
  exit 1
}

mkdir -p "$F/bin" "$F/srv/api/repos/kim0040/gachipad" "$F/install" "$F/systemd"
port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
base="http://127.0.0.1:$port"

# --- fake docker: logs every call; compose reads GACHIPAD_VERSION from ./.env like the real one ----
cat >"$F/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$DOCKER_CALLS"
envfile=.env
compose_file=docker-compose.yml
if [ "$1" = compose ]; then
  shift
  while [[ "${1:-}" == --* || "${1:-}" = -f ]]; do
    case "$1" in
      --env-file) envfile="$2"; shift 2 ;;
      -f) compose_file="$2"; shift 2 ;;
      --project-directory) shift 2 ;;
      *) shift ;;
    esac
  done
  version="$(sed -n 's/^GACHIPAD_VERSION=//p' "$envfile" | tail -1)"
  registry="$(sed -n 's/^GACHIPAD_REGISTRY=//p' "$envfile" | tail -1)"
  registry="${registry:-ghcr.io/kim0040}"
  case "$1" in
    version) exit 0 ;;
    config)
      if [[ "$*" == *--format* ]]; then
        mongo="$(sed -n 's/^    image: \(mongo:[^ ]*\).*/\1/p' "$compose_file" | head -1)"
        printf '{"services":{"mongo":{"image":"%s"}}}\n' "$mongo"
      else for n in web api collab; do printf '%s/gachipad-%s:%s\n' "$registry" "$n" "$version"; done; fi ;;
    run)
      if [ -n "${FAKE_NO_API_IMAGE:-}" ]; then echo 'installed API image is missing' >&2; exit 125; fi
      if [[ "$*" == *readdirSync* ]] && [ -n "${FAKE_NONEMPTY_VOLUME:-}" ]; then
        printf 'nonempty'
        exit 0
      fi
      if [[ " $* " == *' mongo-users '* ]]; then exit 0; fi
      while [ "$1" != -e ]; do shift; done
      node "$@" ;;
    pull)
      if [ -n "${FAKE_PULL_BLOCK:-}" ]; then
        touch "$FAKE_PULL_BLOCK.started"
        while [ ! -f "$FAKE_PULL_BLOCK.continue" ]; do sleep .05; done
      fi
      [ -z "${FAKE_PULL_FAIL:-}" ] || exit 1 ;;
    stop)
      [[ "$*" != *caddy* ]] || touch "$FAKE_DB.closed"
      [[ "$*" != *collab* || -n "${FAKE_NO_FLUSH:-}" ]] || printf 'shutdown-flushed\n' >>"$FAKE_DB" ;;
    ps) printf '%s-fixture\n' "${!#}" ;;
    up)
      if [ "$version" = "${FAKE_INGRESS_FAIL:-none}" ] && [[ " $* " != *' api '* ]]; then
        printf 'accepted-at-ingress\n' >>"$FAKE_DB"
        exit 1
      fi
      printf 'up:%s:%s\n' "$version" "$*" >>"$DOCKER_CALLS"
      if [[ " $* " == *' api '* ]]; then
        if [ "$version" = "${FAKE_HEALTH_BLOCK_VERSION:-none}" ]; then
          printf 'incompatible-schema\n' >"$FAKE_DB"
          touch "$FAKE_HEALTH_BLOCK.started"
          while [ ! -e "$FAKE_HEALTH_BLOCK.continue" ]; do sleep .05; done
        fi
        if [ "$version" = "${FAKE_ROLLBACK_BLOCK_VERSION:-none}" ]; then
          touch "$FAKE_ROLLBACK_BLOCK.started"
          while [ ! -e "$FAKE_ROLLBACK_BLOCK.continue" ]; do sleep .05; done
        fi
        if [ "$version" = "${FAKE_UNHEALTHY:-none}" ]; then
          printf 'incompatible-schema\n' >"$FAKE_DB"
          [ -z "${FAKE_STATUS_FAIL:-}" ] || mkdir -p state/update.json.tmp
          if [ -n "${FAKE_CORRUPT_BACKUP:-}" ]; then
            printf corrupt >"$(ls -t backups/gachipad-*.archive.gz | head -n 1)"
          fi
          echo "container api is unhealthy" >&2; exit 1
        fi
        grep -q incompatible-schema "$FAKE_DB" && { echo 'old API cannot read changed schema' >&2; exit 1; }
      fi ;;
    exec)
      case "${!#}" in
        dump)
          [ -f "$FAKE_DB.closed" ] || exit 1
          if [ -n "${FAKE_DUMP_CORRUPT:-}" ]; then printf corrupt; else gzip -c "$FAKE_DB"; fi ;;
        validate) gzip -t; [ -z "${FAKE_DRYRUN_FAIL:-}" ] || exit 1 ;;
        restore) gzip -dc >"$FAKE_DB"; echo restored >>"$DOCKER_CALLS" ;;
        *) exit 0 ;;
      esac ;;
  esac
  exit 0
fi
if [ "$1" = run ] && [[ "$*" == *readdirSync* ]]; then
  printf nonempty; exit 0
fi
if [ "$1" = volume ] && [ "$2" = inspect ]; then
  [ "${FAKE_NONEMPTY_VOLUME:-}" = "${3:-}" ] && exit 0
  exit 1
fi
if [ "$1" = inspect ]; then
  writer_exit="${FAKE_WRITER_EXIT:-0}"
  case "${!#}" in
    api-fixture) writer_exit="${FAKE_API_EXIT:-$writer_exit}" ;;
    collab-fixture) writer_exit="${FAKE_COLLAB_EXIT:-$writer_exit}" ;;
  esac
  printf '%s false\n' "$writer_exit"; exit 0
fi
if [ "$1" = load ]; then
  # Record which tags and files an archive would import (the bundle fixtures are plain tar files).
  { tar -xOf "$3" manifest.json | grep -o '"RepoTags":\[[^]]*\]'; tar -tf "$3"; } >>"$FAKE_LOADED" 2>/dev/null || true
  exit 0
fi
if [ "$1" = image ] && [ "$2" = inspect ]; then
  [ -z "${FAKE_IMAGE_INSPECT_FAIL:-}" ] || exit 1
  ref="${!#}"
  name="${ref%:*}"
  printf '%s@sha256:%s\n' "$name" "$(printf '%s' "${name##*/}${FAKE_DIGEST_SALT:-}" | sha256sum | cut -c1-64)"
fi
DOCKER
cat >"$F/bin/systemctl" <<'SYSTEMCTL'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >>"$DOCKER_CALLS"
SYSTEMCTL
cat >"$F/bin/crontab" <<'CRONTAB'
#!/usr/bin/env bash
# Like crontab(1): reads the whole new table before replacing the old one.
if [ "${1:-}" = -l ]; then cat "$CRONTAB_FILE" 2>/dev/null || exit 1; else cat >"$CRONTAB_FILE.new" && mv "$CRONTAB_FILE.new" "$CRONTAB_FILE"; fi
CRONTAB
chmod +x "$F/bin"/*
export FAKE_DB="$F/database" FAKE_LOADED="$F/loaded"
printf 'initial-data\n' >"$FAKE_DB"
export PATH="$F/bin:$PATH" DOCKER_CALLS="$F/docker.calls" CRONTAB_FILE="$F/crontab"
export UPDATE_API_URL="$base/api" UPDATE_DOWNLOAD_URL="$base/dl" UPDATE_HEALTH_TIMEOUT=3
digest() { printf '%s' "$1" | sha256sum | cut -c1-64; }

# --- releases: deploy archives laid out as release.yml publishes them ----------------------------
# release <version> [bad-checksum|bad-digest]
release() {
  local v="$1" dir="$F/srv/dl/kim0040/gachipad/releases/download/v$1" stage="$F/stage/gachipad-$1"
  mkdir -p "$dir" "$stage/docs" "$stage/tls" "$stage/state"
  cp "$root"/deploy/{lib.sh,preflight.sh,generate-secrets.sh,install.sh,upgrade.sh,update.sh,backup.sh,restore.sh,migrate-db.sh,mdns.sh,docker-compose.yml} "$stage/"
  cp "$root/deploy/README.md" "$stage/README.md"
  printf '# doc\n' >"$stage/docs/OPERATIONS.md"
  printf '# tls\n' >"$stage/tls/tls.example"
  [ "${2:-}" != mongo-change ] || sed -i 's/mongo:8.0.34/mongo:9.0.0/g' "$stage/docker-compose.yml"
  printf '# release %s\n' "$v" >>"$stage/update.sh"
  sed "s/^GACHIPAD_VERSION=.*/GACHIPAD_VERSION=$v/" "$root/deploy/.env.example" >"$stage/.env.example"
  printf 'NEW_IN_%s=yes\n' "${v//./_}" >>"$stage/.env.example"
  printf '%s\n' "$v" >"$stage/VERSION"
  for n in web api collab mdns; do
    if [ "${2:-}" = bad-digest ]; then printf 'gachipad-%s sha256:%s\n' "$n" "$(digest "other-$n")"
    else printf 'gachipad-%s sha256:%s\n' "$n" "$(digest "gachipad-$n")"; fi
  done >"$stage/IMAGES"
  # shellcheck disable=SC2094 # manifest is excluded from find
  (cd "$stage" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum >SHA256SUMS)
  tar czf "$dir/gachipad-deploy-$v.tar.gz" -C "$F/stage" "gachipad-$v"
  (cd "$dir" && sha256sum "gachipad-deploy-$v.tar.gz" >SHA256SUMS)
  if [ "${2:-}" = bad-checksum ]; then
    sed -i "s/^[0-9a-f]\{64\}/$(digest tampered)/" "$dir/SHA256SUMS"
  fi
}
release 1.0.1
release 1.0.2 bad-checksum
release 1.0.3 bad-digest
release 1.0.4
release 1.0.5
release 1.0.6 mongo-change
release 1.1.0
release 1.1.1
release 2.0.0
releases_json() {
  printf '['
  local first=1 v
  for v in "$@"; do
    [ "$first" = 1 ] || printf ','
    first=0
    printf '{"tag_name":"v%s","name":"gachipad %s","draft":false,"prerelease":%s,"body":"has tag_name inside"}' \
      "$v" "$v" "$([[ "$v" == *-* ]] && echo true || echo false)"
  done
  printf ']'
}
releases_json 2.0.0 1.2.0-rc.1 1.1.0 1.0.5 1.0.4 1.0.3 1.0.2 1.0.1 1.0.0 >"$F/srv/api/repos/kim0040/gachipad/releases"
touch "$F/srv/healthz" "$F/srv/readyz"
python3 -m http.server --bind 127.0.0.1 --directory "$F/srv" "$port" >/dev/null 2>&1 &
server=$!
for _ in $(seq 50); do curl -fs "$base/healthz" >/dev/null 2>&1 && break; sleep 0.1; done

# --- an installation of 1.0.0 --------------------------------------------------------------------
I="$F/install"
cp "$root"/deploy/{lib.sh,preflight.sh,generate-secrets.sh,install.sh,upgrade.sh,update.sh,backup.sh,restore.sh,migrate-db.sh,mdns.sh,docker-compose.yml,.env.example,README.md} "$I/"
sed -e 's/^GACHIPAD_VERSION=.*/GACHIPAD_VERSION=1.0.0/' -e "s/^HTTP_PORT=.*/HTTP_PORT=$port/" -e 's/^GACHIPAD_DB=sqlite/GACHIPAD_DB=mongodb/' "$I/.env.example" >"$I/.env"
(cd "$I" && ./generate-secrets.sh .env >/dev/null)
envv() { sed -n "s/^$1=//p" "$I/.env" | tail -n 1; }
status() { cat "$I/state/update.json"; }
# Wait for the updater's process-substitution logger to close before reading its output.
run() { (cd "$I" && "$@") 2>&1 | cat >"$F/run.log"; }
calls() { cat "$DOCKER_CALLS" 2>/dev/null || true; }
# images_tar OUT VERSION [legacy]: a docker-save style archive of the web, api and mdns images. The legacy
# layout uses <id>/layer.tar and stores the mdns layer as a link to the web layer.
images_tar() {
  local out="$1" v="$2" legacy="${3:-}" w n config layer manifest="" sep=""
  w="$(mktemp -d "$F/images.XXXXXX")"
  for n in web api mdns; do
    if [ -z "$legacy" ]; then
      mkdir -p "$w/blobs/sha256"
      config="blobs/sha256/$(digest "config-$n")" layer="blobs/sha256/$(digest "layer-$n")"
      printf 'config-%s\n' "$n" >"$w/$config"
      printf 'layer-%s\n' "$n" >"$w/$layer"
    else
      mkdir -p "$w/$n"
      config="$n.json" layer="$n/layer.tar"
      printf 'config-%s\n' "$n" >"$w/$config"
      printf 'layer-%s\n' "$n" >"$w/$layer"
    fi
    manifest+="$sep{\"Config\":\"$config\",\"RepoTags\":[\"ghcr.io/kim0040/gachipad-$n:$v\"],\"Layers\":[\"$layer\"]}"
    sep=,
  done
  if [ -n "$legacy" ]; then rm "$w/mdns/layer.tar" && ln -s ../web/layer.tar "$w/mdns/layer.tar"; fi
  printf '[%s]\n' "$manifest" >"$w/manifest.json"
  printf '{}\n' >"$w/index.json"
  (cd "$w" && tar cf "$out" -- *)
  rm -rf "$w"
}

step "--check: newest of this major and the new major, nothing changes"
run ./update.sh --check || fail "--check failed"
grep -q 'installed 1.0.0, newest 2.0.0' "$F/run.log" || fail "--check did not name 2.0.0"
grep -q 'update with ./update.sh (to 1.1.0) or ./update.sh --allow-major (to 2.0.0)' "$F/run.log" || fail "--check advice"
grep -q 9.9.9 "$F/run.log" && fail "read a tag from inside a release body"
[ -f "$I/state/update.json" ] && fail "--check wrote a status"
[ "$(envv GACHIPAD_VERSION)" = 1.0.0 ] || fail "version changed"
ok "--check: 1.1.0 within 1.x, 2.0.0 needs --allow-major; pre-release 1.2.0-rc.1 not offered"

step "release list HTTP errors and an unreadable .env say what to do"
UPDATE_API_URL="$base/missing" run ./update.sh --check && fail "--check passed without a release list"
grep -q 'cannot fetch release list from .*(HTTP 404); check UPDATE_REPO' "$F/run.log" || fail "HTTP status not named"
if command -v wget >/dev/null; then
  printf '%s\n' 'command() { if [ "${1:-}" = -v ] && [ "${2:-}" = curl ]; then return 1; fi; builtin command "$@"; }' >"$F/no-curl-env"
  BASH_ENV="$F/no-curl-env" UPDATE_API_URL="$base/missing" run ./update.sh --check && fail "wget --check passed without a release list"
  grep -q 'cannot fetch release list from .*(HTTP 404); check UPDATE_REPO' "$F/run.log" || fail "wget HTTP status not named"
fi
rm -f "$I/state/update.json" "$I/state/last-run"
if [ "$(id -u)" != 0 ]; then
  chmod 000 "$I/.env"
  run ./update.sh --check && { chmod 600 "$I/.env"; fail "--check passed with an unreadable .env"; }
  chmod 600 "$I/.env"
  grep -q 'cannot read .env as .*sudo ./update.sh --check' "$F/run.log" || fail "unreadable .env not explained"
  chmod 000 "$I/.env"
  run ./backup.sh && { chmod 600 "$I/.env"; fail "backup.sh passed with an unreadable .env"; }
  chmod 600 "$I/.env"
  grep -q 'cannot read .env as .*sudo ./update.sh --check' "$F/run.log" || fail "backup.sh did not explain the unreadable .env"
fi
ok "HTTP 404 named; unreadable .env names the sudo fix"

step "a run as root hands files back to the folder owner, except tls, links and other devices"
G="$F/giveback"
mkdir -p "$G/backups" "$G/state" "$G/tls" "$G/rollback/tls" "$G/sub dir"
touch "$G/.env" "$G/update.sh" "$G/backups/a.gz" "$G/tls/key.pem" "$G/rollback/tls/key.pem" "$G/sub dir/x y" "$G/state/update.log"
ln -s /etc/hostname "$G/link"
ln "$G/backups/a.gz" "$G/backups/b.gz"
(
  cd "$I" && . ./lib.sh
  # Pretend to be root and that the folder belongs to uid 4242, so every file here is "not the owner's".
  id() { if [ "${1:-}" = -u ]; then echo 0; else command id "$@"; fi; }
  stat() { if [ "${1:-}" = -c ] && [ "${2:-}" = '%u:%g' ]; then echo 4242:4242; else command stat "$@"; fi; }
  chown() { printf '%s %s\n' "$2" "${*: -1}" >>"$F/chowned"; }
  give_back_files "$G"
)
for want in .env update.sh backups state state/update.log rollback "sub dir" "sub dir/x y"; do
  grep -qxF "4242:4242 $G/$want" "$F/chowned" || fail "not handed back: $want"
done
for skip in tls tls/key.pem rollback/tls rollback/tls/key.pem link backups/a.gz backups/b.gz; do
  grep -qF " $G/$skip" "$F/chowned" && fail "handed back: $skip"
done
(cd "$I" && . ./lib.sh && chown() { printf 'called\n' >>"$F/chowned-user"; } && give_back_files "$G")
[ -e "$F/chowned-user" ] && fail "a non-root run changed owners"
ok "root run: owner gets .env, scripts, backups, state, rollback; tls, links and hard links kept"

step "a major version is refused"
if run ./update.sh --version 2.0.0 --yes; then fail "major update accepted"; else [ $? = 3 ] || fail "exit code"; fi
grep -q 'new major version' "$F/run.log" || fail "major refusal message"
status | grep -q '"result":"refused"' || fail "refusal not recorded"
calls | grep -q 'pull$' && fail "pulled during a refusal"
ok "2.0.0 refused without --allow-major, recorded"

step "checksum mismatch: refused before backup or pull"
: >"$DOCKER_CALLS"
run ./update.sh --version 1.0.2 --yes && fail "accepted a tampered archive"
grep -q 'checksum mismatch: gachipad-deploy-1.0.2.tar.gz' "$F/run.log" || fail "wrong refusal"
calls | grep -q 'exec -T .*mongo sh' && fail "backup ran"
calls | grep -q 'pull$' && fail "pulled"
[ "$(envv GACHIPAD_VERSION)" = 1.0.0 ] || fail "version changed"
status | grep -q '"result":"failed","from":"1.0.0","to":"1.0.2"' || fail "failure not recorded"
ok "1.0.2 with a wrong checksum refused; no backup, no pull, .env unchanged"

step "happy path 1.0.0 -> 1.0.1"
# A fixed-file-list legacy updater can leave the new command absent until this update.
rm -f "$I/migrate-db.sh"
if [ -z "${MDNS_LEGACY_FIXTURE:-}" ]; then
  # Insert assertions after lib loading without replacing the real backup implementation.
  python3 - "$I/backup.sh" <<'BACKUP_PROBE'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text().replace('. ./lib.sh\n', '. ./lib.sh\n' + 'grep -qx "FROM=1.0.0" state/transaction || exit 91\ngrep -qx "PHASE=prepared" state/transaction || exit 92\n[ "$(cat state/install.lock.d/owner)" = "$GACHIPAD_LOCK_PID" ] || exit 93\n[ "$GACHIPAD_LOCK_PID" != "$$" ] || exit 94\necho inherited-update-backup >>"$DOCKER_CALLS"\n', 1)
p.write_text(s)
BACKUP_PROBE
fi
printf '\nCOMPOSE_PROFILES=mongodb,mdns\nMDNS_HOSTNAME=gachipad-2.local\n' >>"$I/.env"
if [ -n "${MDNS_LEGACY_FIXTURE:-}" ]; then
  cp "$MDNS_LEGACY_FIXTURE"/{update.sh,lib.sh} "$I/"
  rm -f "$I/mdns.sh"
fi
: >"$DOCKER_CALLS"
run ./update.sh --version 1.0.1 --yes || fail "update failed"
if [ -z "${MDNS_LEGACY_FIXTURE:-}" ]; then
  grep -qx inherited-update-backup "$DOCKER_CALLS" || fail "real update backup child path not exercised"
fi
if [ -n "${MDNS_LEGACY_FIXTURE:-}" ]; then
  [ ! -e "$I/mdns.sh" ] || fail 'old updater unexpectedly copied the new helper'
  grep -q './update.sh --mdns-tools /path/to/matching-bundle.tar.gz' "$F/run.log" || fail 'old updater did not print recovery command'
  stage="$F/stage/gachipad-1.0.1"
  images_tar "$stage/images.tar" 1.0.1
  # shellcheck disable=SC2094 # manifest is excluded from find
  (cd "$stage" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum >SHA256SUMS)
  tar czf "$F/legacy-offline.tar.gz" -C "$F/stage" gachipad-1.0.1
  sha256sum "$F/legacy-offline.tar.gz" >"$F/legacy-offline.tar.gz.sha256"
  run ./update.sh --mdns-tools "$F/legacy-offline.tar.gz" || fail 'first-update offline repair failed'
  [ -x "$I/mdns.sh" ] || fail 'first-update repair did not install helper'
  ok 'actual legacy updater omits helper, prints one-step command; offline command installs helper and images'
fi
[ "$(envv GACHIPAD_VERSION)" = 1.0.1 ] || fail "GACHIPAD_VERSION not 1.0.1"
[ "$(envv NEW_IN_1_0_1)" = yes ] || fail "new setting not added"
[ "$(cat "$I/VERSION")" = 1.0.1 ] || fail "files not installed"
if [ -z "${MDNS_LEGACY_FIXTURE:-}" ]; then
  [ -x "$I/migrate-db.sh" ] || fail "new migration command not installed"
fi
tail -n 1 "$I/update.sh" | grep -q '^# release 1.0.1' || fail "update.sh not replaced"
grep -q 'exec -T .*mongo sh' "$DOCKER_CALLS" || fail "no backup"
grep -q 'exec -T -e MONGO_DATABASE=gachipad -e MONGO_INITDB_ROOT_USERNAME=gachipad mongo' "$DOCKER_CALLS" || fail "backup did not name the database and user"
ls "$I"/backups/gachipad-*.archive.gz >/dev/null || fail "no backup file"
grep -q 'pull$' "$DOCKER_CALLS" || fail "no pull"
grep -q '^compose up -d --wait' "$DOCKER_CALLS" || fail "no up"
status | grep -q '"result":"updated","from":"1.0.0","to":"1.0.1"' || fail "status not updated"
[ "$(stat -c %a "$I/state/update.json")" = 644 ] || fail "update.json is not readable by the api container"
[ "$(stat -c %a "$I/state/update.log")" = 600 ] || fail "update.log is not private"
[ ! -e "$I/state/transaction" ] || fail "committed transaction marker remains"
[ -f "$I/rollback/.env" ] || fail "snapshot not preserved outside state"
[ ! -e "$I/state/rollback" ] || fail "secrets remain in the API state mount"
grep -q 'updating 1.0.0 -> 1.0.1' "$I/state/update.log" || fail "not logged"
[ "$(envv COMPOSE_PROFILES)" = mdns,mongodb ] || fail 'update changed the mDNS choice'
[ "$(envv MDNS_HOSTNAME)" = gachipad-2.local ] || fail 'update changed the selected hostname'
ok "1.0.1 installed: files, setting, backup, pull, up, status, log; mDNS choice and hostname retained"

step "a downgrade is refused"
run ./update.sh --version 1.0.0 --yes && fail "downgrade accepted"
grep -q 'older than 1.0.1' "$F/run.log" || fail "downgrade message"
[ "$(envv GACHIPAD_VERSION)" = 1.0.1 ] || fail "version changed"
ok "1.0.0 refused on 1.0.1"

step "pulled images with other digests: nothing restarts, files go back"
: >"$DOCKER_CALLS"
run ./update.sh --version 1.0.3 --yes && fail "accepted wrong image digests"
grep -q 'is not the released image' "$F/run.log" || fail "digest message"
grep -q '^compose up' "$DOCKER_CALLS" && fail "restarted with unverified images"
[ "$(envv GACHIPAD_VERSION)" = 1.0.1 ] || fail "version not put back"
[ "$(cat "$I/VERSION")" = 1.0.1 ] || fail "files not put back"
ok "1.0.3 refused after pull; 1.0.1 files and version back, no restart"

step "health check fails: rollback to the previous version and the backup"
: >"$DOCKER_CALLS"
if FAKE_UNHEALTHY=1.0.4 run ./update.sh --version 1.0.4 --yes; then fail "unhealthy update reported success"; fi
grep -q 'rolling back to 1.0.1' "$F/run.log" || fail "no rollback"
[ "$(envv GACHIPAD_VERSION)" = 1.0.1 ] || fail "version not rolled back"
[ "$(cat "$I/VERSION")" = 1.0.1 ] || fail "files not rolled back"
tail -n 1 "$I/update.sh" | grep -q '^# release 1.0.1' || fail "update.sh not rolled back"
grep -q '^restored' "$DOCKER_CALLS" || fail "backup not restored"
[ "$(grep -c '^compose up' "$DOCKER_CALLS")" -ge 2 ] || fail "previous version not started"
status | grep -q '"result":"rolled-back","from":"1.0.1","to":"1.0.4"' || fail "rollback not recorded"
grep -q '^initial-data$' "$FAKE_DB" || fail "backup data lost"
grep -q '^shutdown-flushed$' "$FAKE_DB" || fail "collab flush not in backup"
grep -q '^GACHIPAD_VERSION=1.0.0$' "$I"/rollback.previous.*/.env || fail "previous snapshot was discarded"
python3 - "$DOCKER_CALLS" <<'ORDER'
import sys
s=open(sys.argv[1]).read().splitlines()
r=s.index('restored')
assert not any(x.startswith('up:1.0.1:') and ' api ' in x+' ' for x in s[:r]), s
assert any(x.startswith('up:1.0.1:') and ' api ' in x+' ' for x in s[r+1:]), s
ORDER
ok "1.0.4 changed the DB: restore precedes the old API; pre-backup collab flush survives"

step "corrupt archives, failed dry runs and corrupt dumps never replace the current DB"
cp "$FAKE_DB" "$F/db-before"
printf corrupt >"$F/corrupt.gz"
: >"$DOCKER_CALLS"
run ./restore.sh "$F/corrupt.gz" --yes && fail "corrupt restore accepted"
cmp "$FAKE_DB" "$F/db-before" || fail "corrupt restore changed DB"
grep -q 'restore\|stop' "$DOCKER_CALLS" && fail "corrupt restore reached Mongo or stopped writers"
gzip -c "$F/db-before" >"$F/valid.gz"
FAKE_NO_FLUSH=1 FAKE_DRYRUN_FAIL=1 run ./restore.sh "$F/valid.gz" --yes && fail "failed dry run accepted"
cmp "$FAKE_DB" "$F/db-before" || fail "dry run failure changed DB"
grep -q '^restored$' "$DOCKER_CALLS" && fail "restore ran after a failed dry run"
FAKE_DUMP_CORRUPT=1 run ./backup.sh "$F/corrupt-backups" && fail "corrupt dump published"
find "$F/corrupt-backups" -type f | grep -q . && fail "corrupt dump retained"
FAKE_NO_FLUSH=1 FAKE_WRITER_EXIT=137 run ./restore.sh "$F/valid.gz" --yes || fail "restore after crashed/OOM writers failed"
cmp "$FAKE_DB" "$F/db-before" || fail "restore data mismatch"
ok "gzip and dry-run failures retain DB; restore tolerates crashed writers and takes safety dump"

step "status write failure after successful recovery keeps ingress open and releases lock"
: >"$DOCKER_CALLS"
FAKE_STATUS_FAIL=1 FAKE_UNHEALTHY=1.0.4 run ./update.sh --version 1.0.4 --yes && fail "bad update succeeded"
[ "$(envv GACHIPAD_VERSION)" = 1.0.1 ] || fail "status failure prevented rollback"
[ ! -e "$I/state/install.lock.d" ] || fail "status failure leaked lock"
[ ! -e "$I/state/transaction" ] || fail "finished recovery left marker"
grep -q 'recovery complete but status could not be written' "$F/run.log" || fail "status warning missing"
tail -n 1 "$DOCKER_CALLS" | grep -q '^up:1.0.1:' || fail "recovered service stopped after status failure"
rmdir "$I/state/update.json.tmp"
ok "disk-full equivalent status failure leaves recovered service running and unlocks"

step "a corrupt rollback archive retains the failed-state DB, marker and snapshot, and unlocks"
: >"$DOCKER_CALLS"
FAKE_STATUS_FAIL=1 FAKE_CORRUPT_BACKUP=1 FAKE_UNHEALTHY=1.0.4 run ./update.sh --version 1.0.4 --yes && fail "bad update succeeded"
grep -q '^incompatible-schema$' "$FAKE_DB" || fail "corrupt rollback archive destroyed the current DB"
grep -q '^restored$' "$DOCKER_CALLS" && fail "corrupt archive restored"
[ -e "$I/state/transaction" ] || fail "failed recovery lost transaction marker"
[ -e "$I/rollback/.env" ] || fail "failed recovery lost snapshot"
[ ! -e "$I/state/install.lock.d" ] || fail "failed recovery with status error leaked lock"
rmdir "$I/state/update.json.tmp"
run ./restore.sh "$F/valid.gz" --yes || fail "manual recovery from corrupt rollback archive failed"
rm "$I/state/transaction"
ok "corrupt rollback archive leaves current DB intact; failed status cannot leak lock; manual restore works"

step "both API and Collab abnormal exit prevent a consistency backup"
for service in API COLLAB; do
  : >"$DOCKER_CALLS"
  run env "FAKE_${service}_EXIT=137" ./update.sh --version 1.0.4 --yes && fail "$service abnormal exit accepted"
  grep -q "${service,,} did not shut down cleanly" "$F/run.log" || fail "$service exit not checked"
  grep -q 'dump\|^restored$' "$DOCKER_CALLS" && fail "$service failure backed up an inconsistent boundary"
  [ ! -e "$I/state/install.lock.d" ] || fail "$service failure leaked lock"
done
ok "API and Collab exit 137 each refuse the backup boundary and safely recover"

step "automatic updates: off by default, patch policy, systemd timer"
run ./update.sh --auto && fail "--auto ran without being enabled"
grep -q 'automatic updates are off' "$F/run.log" || fail "--auto refusal"
GACHIPAD_INIT=systemd GACHIPAD_SYSTEMD_DIR="$F/systemd" run ./update.sh --enable-auto --at 03:30 --policy patch --dry-run ||
  fail "dry run failed"
grep -q 'OnCalendar=\*-\*-\* 03:30:00' "$F/run.log" || fail "dry run timer"
grep -q 'dry-run: systemctl enable --now gachipad-update.timer' "$F/run.log" || fail "dry run enable"
[ -e "$F/systemd/gachipad-update.timer" ] && fail "dry run wrote the timer"
[ -e "$I/state/auto.conf" ] && fail "dry run enabled auto"
: >"$DOCKER_CALLS"
GACHIPAD_INIT=systemd GACHIPAD_SYSTEMD_DIR="$F/systemd" run ./update.sh --enable-auto --at 03:30 --policy patch || fail "enable failed"
grep -q "ExecStart=$I/update.sh --auto" "$F/systemd/gachipad-update.service" || fail "service unit"
grep -q '^KillMode=mixed$' "$F/systemd/gachipad-update.service" || fail "systemd kills recovery children"
grep -q '^TimeoutStopSec=30min$' "$F/systemd/gachipad-update.service" || fail "systemd recovery budget"
grep -q 'OnCalendar=\*-\*-\* 03:30:00' "$F/systemd/gachipad-update.timer" || fail "timer unit"
grep -q 'systemctl enable --now gachipad-update.timer' "$DOCKER_CALLS" || fail "timer not enabled"
status | grep -q '"auto":{"enabled":true,"at":"03:30","policy":"patch"}' || fail "auto not in status"
status | grep -q '"lastRun":{"at":' || fail "enable lost the last run"
# 1.0.5 is the newest patch of 1.0; 1.1.0 is a minor update the patch policy leaves alone.
run ./update.sh --auto || fail "--auto failed"
[ "$(envv GACHIPAD_VERSION)" = 1.0.5 ] || fail "--auto did not pick 1.0.5"
run ./update.sh --auto || fail "second --auto failed"
grep -q 'gachipad 1.0.5 is up to date' "$F/run.log" || fail "--auto went past the patch policy"
GACHIPAD_INIT=systemd GACHIPAD_SYSTEMD_DIR="$F/systemd" run ./update.sh --disable-auto || fail "disable failed"
[ -e "$F/systemd/gachipad-update.timer" ] && fail "timer left behind"
grep -q 'systemctl disable --now gachipad-update.timer' "$DOCKER_CALLS" || fail "timer not disabled"
status | grep -q '"auto":{"enabled":false' || fail "auto still on in status"
ok "systemd timer on and off; --auto took 1.0.5 and left 1.1.0"

step "cron when there is no systemd"
printf '0 1 * * * echo keep-me\n' >"$CRONTAB_FILE"
GACHIPAD_INIT=cron run ./update.sh --enable-auto --at 04:05 --policy minor || fail "cron enable failed"
grep -q "^5 4 \* \* \* cd '$I' && ./update.sh --auto" "$CRONTAB_FILE" || fail "cron entry"
grep -q keep-me "$CRONTAB_FILE" || fail "other cron entries lost"
GACHIPAD_INIT=cron run ./update.sh --enable-auto --at 04:05 --policy minor || fail "cron re-enable failed"
[ "$(grep -c 'gachipad-update' "$CRONTAB_FILE")" = 1 ] || fail "duplicate cron entries"
GACHIPAD_INIT=cron run ./update.sh --disable-auto || fail "cron disable failed"
grep -q gachipad-update "$CRONTAB_FILE" && fail "cron entry left behind"
grep -q keep-me "$CRONTAB_FILE" || fail "other cron entries lost on disable"
run ./update.sh --enable-auto --at 25:00 && fail "accepted --at 25:00"
ok "cron entry added once, removed, other entries kept; bad time refused"

# legacy codesh name (1.0.x); remove in 2.0
step "a legacy installation keeps the old timer name only when one exists"
printf 'GACHIPAD_LEGACY_INSTALL=1\n' >>"$I/.env"
GACHIPAD_INIT=systemd GACHIPAD_SYSTEMD_DIR="$F/systemd" run ./update.sh --enable-auto --dry-run || fail "legacy dry run failed"
grep -q 'enable --now gachipad-update.timer' "$F/run.log" || fail "legacy host without a timer did not get the new unit name"
: >"$F/systemd/codesh-update.timer"
GACHIPAD_INIT=systemd GACHIPAD_SYSTEMD_DIR="$F/systemd" run ./update.sh --enable-auto --dry-run || fail "old timer dry run failed"
grep -q 'enable --now codesh-update.timer' "$F/run.log" || fail "the existing codesh-update timer was not kept"
rm -f "$F/systemd/codesh-update.timer"
GACHIPAD_INIT=cron run ./update.sh --enable-auto --dry-run || fail "legacy cron dry run failed"
grep -q "# gachipad-update $I" "$F/run.log" || fail "legacy host without a cron entry did not get the new tag"
printf '0 1 * * * cd %s && ./update.sh --auto # codesh-update %s\n' "$I" "$I" >"$CRONTAB_FILE"
GACHIPAD_INIT=cron run ./update.sh --enable-auto --dry-run || fail "old cron dry run failed"
grep -q "# codesh-update $I" "$F/run.log" || fail "the existing codesh-update cron entry was not kept"
rm -f "$CRONTAB_FILE"
sed -i '/^GACHIPAD_LEGACY_INSTALL=/d' "$I/.env"
ok "codesh-update name kept only for an existing timer or cron entry"

step "Mongo tools take the database and user from .env, not from the container"
mongo_names() { # <env lines> -> the -e arguments the transfer passed to the container
  local d="$F/names"
  rm -rf "$d" && mkdir -p "$d" && printf '%s' "$1" >"$d/.env"
  : >"$DOCKER_CALLS"
  # shellcheck source=/dev/null
  (cd "$d" && source "$I/lib.sh" && gzip -c </dev/null | mongo_transfer validate) >/dev/null 2>&1 || fail "mongo_transfer failed"
  grep -o 'exec -T -e MONGO_DATABASE=[^ ]* -e MONGO_INITDB_ROOT_USERNAME=[^ ]*' "$DOCKER_CALLS" | head -n 1
}
[ "$(mongo_names $'SESSION_SECRET=x\n')" = 'exec -T -e MONGO_DATABASE=gachipad -e MONGO_INITDB_ROOT_USERNAME=gachipad' ] || fail "fresh default names"
[ "$(mongo_names $'GACHIPAD_LEGACY_INSTALL=1\n')" = 'exec -T -e MONGO_DATABASE=codesh -e MONGO_INITDB_ROOT_USERNAME=codesh' ] || fail "legacy names"
[ "$(mongo_names $'CODESH_VERSION=1.0.1\n')" = 'exec -T -e MONGO_DATABASE=codesh -e MONGO_INITDB_ROOT_USERNAME=codesh' ] || fail "unmigrated legacy names"
[ "$(mongo_names $'MONGO_DATABASE=mine\nMONGO_ROOT_USER=root1\nGACHIPAD_LEGACY_INSTALL=1\n')" = 'exec -T -e MONGO_DATABASE=mine -e MONGO_INITDB_ROOT_USERNAME=root1' ] || fail "explicit names"
ok "database and root user resolved on the host: explicit, legacy codesh, else gachipad"

step "backup and restore dispatch follow GACHIPAD_DB"
for db in sqlite postgres mongodb; do
  route="$F/route-$db"
  mkdir -p "$route"
  printf 'GACHIPAD_DB=%s\n' "$db" >"$route/.env"
  : >"$DOCKER_CALLS"
  (
    cd "$route"
    # shellcheck source=/dev/null
    source "$I/lib.sh"
    # shellcheck disable=SC2317 # selected indirectly by database_backup/database_restore
    sqlite_backup() { echo sqlite-backup; }
    # shellcheck disable=SC2317 # selected indirectly by database_backup/database_restore
    postgres_backup() { echo postgres-backup; }
    # shellcheck disable=SC2317 # selected indirectly by database_backup/database_restore
    mongo_backup() { echo mongodb-backup; }
    # shellcheck disable=SC2317 # selected indirectly by database_backup/database_restore
    sqlite_restore() { echo sqlite-restore; }
    # shellcheck disable=SC2317 # selected indirectly by database_backup/database_restore
    postgres_restore() { echo postgres-restore; }
    # shellcheck disable=SC2317 # selected indirectly by database_backup/database_restore
    mongo_restore() { echo mongodb-restore; }
    database_start 3
    database_backup ./backups
    database_restore fixture.archive.gz
  ) >"$F/route-$db.log" 2>&1 || fail "$db backup/restore route failed"
  grep -qx "$db-backup" "$F/route-$db.log" || fail "$db backup route"
  grep -qx "$db-restore" "$F/route-$db.log" || fail "$db restore route"
  case "$db" in
    sqlite) grep -q '^compose up .* valkey$' "$DOCKER_CALLS"; ! grep -Eq '^compose up .* (mongo|postgres)' "$DOCKER_CALLS" ;;
    postgres) grep -q '^compose up .* postgres valkey$' "$DOCKER_CALLS"; ! grep -q ' mongo' "$DOCKER_CALLS" ;;
    mongodb)
      grep -q '^compose up .* mongo valkey$' "$DOCKER_CALLS"
      grep -q '^compose run --rm --no-deps --pull never -T mongo-users$' "$DOCKER_CALLS"
      ;;
  esac || fail "$db startup service selection"
done
ok "selected database startup and SQLite, PostgreSQL and MongoDB backup/restore dispatch match GACHIPAD_DB"

route="$F/route-external"
mkdir -p "$route"
printf 'GACHIPAD_DB=external\nDATABASE_URL=postgresql://user:secret@db.invalid/gachipad\n' >"$route/.env"
(
  cd "$route"
  # shellcheck source=/dev/null
  source "$I/lib.sh"
  GACHIPAD_EXTERNAL_BACKUP_CONFIRMED=1 database_backup ./backups
) >"$F/route-external.log" 2>&1 || fail "external backup acknowledgement failed"
grep -q 'no local backup was made' "$F/route-external.log" || fail "external backup notice"
if grep -q 'secret@db' "$F/route-external.log"; then fail "external URL was printed"; fi
# shellcheck source=/dev/null
if (cd "$route" && source "$I/lib.sh" && database_restore fixture.archive.gz) >"$F/route-external-restore.log" 2>&1; then
  fail "external database accepted a local restore"
fi
grep -q 'external databases cannot be restored' "$F/route-external-restore.log" || fail "external restore notice"
if grep -q 'secret@db' "$F/route-external-restore.log"; then fail "external URL leaked from restore"; fi
ok "external backup prints its operator duty and creates no local archive; local restore is refused"

mkdir -p "$F/route-switch/state"
printf 'mongodb\n' >"$F/route-switch/state/database-kind"
printf 'GACHIPAD_DB=postgres\n' >"$F/route-switch/.env"
# shellcheck source=/dev/null
if (cd "$F/route-switch" && source "$I/lib.sh" && assert_database_backend) >"$F/route-switch.log" 2>&1; then
  fail "backend switch without data-copy support was accepted"
fi
grep -q 'database backend change refused (mongodb -> postgres)' "$F/route-switch.log" || fail "switch refusal message"
ok "recorded MongoDB installations refuse a switch to PostgreSQL"

mkdir -p "$F/route-volume"
printf 'GACHIPAD_DB=postgres\nGACHIPAD_PROJECT=volume-switch\n' >"$F/route-volume/.env"
export FAKE_NONEMPTY_VOLUME=volume-switch_mongo-data
# shellcheck source=/dev/null
if (cd "$F/route-volume" && source "$I/lib.sh" && assert_database_backend) >"$F/route-volume.log" 2>&1; then
  fail "backend switch with an existing MongoDB volume was accepted"
fi
grep -q 'database backend change refused: non-empty mongodb volume volume-switch_mongo-data' "$F/route-volume.log" ||
  fail "volume switch refusal message"
unset FAKE_NONEMPTY_VOLUME
ok "non-empty old MongoDB volume refuses a switch even without the state marker"

step "external checks are read-only; updates require external backup acknowledgement"
cp "$I/.env" "$F/external-original.env"
# shellcheck source=/dev/null
(cd "$I" && source ./lib.sh; env_set DATABASE_URL 'postgresql://fixture:private@external.invalid/db'; env_set GACHIPAD_DB external)
printf 'external\n' >"$I/state/database-kind"
: >"$DOCKER_CALLS"
run ./update.sh --check || fail "external --check required a backup"
if run ./update.sh --version 1.1.0 --yes; then fail "external update without acknowledgement accepted"; fi
grep -q 'GACHIPAD_EXTERNAL_BACKUP_CONFIRMED=1' "$F/run.log" || fail "external backup guidance missing"
grep -q 'stop\|dump\|pull$' "$DOCKER_CALLS" && fail "external refusal mutated the stack"
# Persisted acknowledgement must work for timers, without inherited shell variables.
# shellcheck source=/dev/null
(cd "$I" && source ./lib.sh; env_set GACHIPAD_EXTERNAL_BACKUP_CONFIRMED 1)
printf 'AT=03:00\nPOLICY=minor\n' >"$I/state/auto.conf"
cp "$FAKE_DB" "$F/external-original-db"
if FAKE_UNHEALTHY=1.1.0 run ./update.sh --auto; then fail "unhealthy external auto-update succeeded"; fi
grep -q 'external database was not restored' "$F/run.log" || fail "persisted acknowledgement did not reach auto-update"
grep -qF "cd $I && docker compose up -d --wait --wait-timeout 3 && rm -f state/transaction" "$F/run.log" || fail "exact external recovery command missing"
[ -f "$I/state/transaction" ] || fail "failed external update lost recovery marker"
# The operator restores the external backup before clearing the marker and restarting.
cp "$F/external-original-db" "$FAKE_DB"
rm -f "$I/state/transaction" "$I/state/auto.conf"
cp "$F/external-original.env" "$I/.env"
printf 'mongodb\n' >"$I/state/database-kind"
ok "external --check works and unacknowledged update refuses before maintenance"

step "Mongo image changes are refused before maintenance and backup"
: >"$DOCKER_CALLS"
run ./update.sh --version 1.0.6 --yes && fail "Mongo major change accepted"
grep -q 'supported migration' "$F/run.log" || fail "no Mongo migration refusal"
grep -q 'stop\|dump' "$DOCKER_CALLS" && fail "stopped or backed up before Mongo refusal"
[ "$(envv GACHIPAD_VERSION)" = 1.0.5 ] || fail "Mongo refusal changed files"
ok "Mongo image change refused before any writes or backup"

step "insufficient backup space refuses maintenance"
cat >"$F/bin/df" <<'SPACE'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 100 100 0 100%% /\n'
SPACE
chmod +x "$F/bin/df"
: >"$DOCKER_CALLS"
run ./update.sh --version 1.1.0 --yes && fail "maintenance accepted without backup space"
grep -q 'twice the last backup size' "$F/run.log" || fail "space refusal missing"
grep -q 'stop\|dump' "$DOCKER_CALLS" && fail "maintenance started without backup space"
rm "$F/bin/df"
ok "twice the last backup size required before stopping ingress or writers"

step "stable parses objects, not tag-like text, and excludes draft/flag-only prerelease"
cp "$F/srv/api/repos/kim0040/gachipad/releases" "$F/releases.original"
cat >"$F/srv/api/repos/kim0040/gachipad/releases" <<'JSON'
[{"tag_name":"v8.0.0","prerelease":true},{"tag_name":"v9.0.0","draft":true},
 {"tag_name":"v3.0.0-rc.1"},{"tag_name":"v5.0.0-01"},{"tag_name":"v06.0.0"},
 {"tag_name":"v7.0.0-rc..1"},{"tag_name":"v4.0.0","prerelease":"false"},{"tag_name":"v7.0.0","draft":null},
 {"tag_name":"v1.1.0+build.1","body":"\"tag_name\":\"v99.0.0\""}]
JSON
run ./update.sh --check || fail "mixed releases check"
grep -q 'newest 1.1.0 ' "$F/run.log" || fail "stable picked a draft, prerelease or invalid version"
UPDATE_CHANNEL=prerelease run ./update.sh --check || fail "prerelease check"
grep -q 'newest 8.0.0 ' "$F/run.log" || fail "prerelease channel did not include flag-only prerelease"
cat >"$F/parser-env" <<'PARSER'
command() {
  if [ "${1:-}" = -v ]; then
    case ",${HIDE_PARSERS:-}," in *",${2:-},"*) return 1 ;; esac
  fi
  builtin command "$@"
}
PARSER
for hidden in node node,python3 node,python3,jq; do
  if [ "$hidden" = node,python3 ] && ! command -v jq >/dev/null; then continue; fi
  BASH_ENV="$F/parser-env" HIDE_PARSERS="$hidden" run ./update.sh --check || fail "parser fallback $hidden"
  grep -q 'newest 1.1.0 ' "$F/run.log" || fail "parser fallback changed channel rules: $hidden"
done
FAKE_NO_API_IMAGE=1 run ./update.sh --check || fail "host parser requires an API image"
BASH_ENV="$F/parser-env" HIDE_PARSERS=node,python3,jq FAKE_NO_API_IMAGE=1 run ./update.sh --check && fail "missing parser/image accepted"
grep -q 'install host node/python3/jq or load the installed API image' "$F/run.log" || fail "missing API image advice"
mv "$F/releases.original" "$F/srv/api/repos/kim0040/gachipad/releases"
ok "mixed JSON list channel rules and semver validation"

step "writes during download/pull and the shutdown flush survive a failed update"
: >"$DOCKER_CALLS"
FAKE_PULL_BLOCK="$F/pull" FAKE_UNHEALTHY=1.1.0 run ./update.sh --version 1.1.0 --yes &
job=$!
for _ in $(seq 100); do [ -f "$F/pull.started" ] && break; sleep .05; done
[ -f "$F/pull.started" ] || fail "pull did not start"
printf 'accepted-during-pull\n' >>"$FAKE_DB"
grep -q 'dump' "$DOCKER_CALLS" && fail "backup happened before downloads completed"
touch "$F/pull.continue"
wait "$job" && fail "bad image succeeded"
grep -q '^accepted-during-pull$' "$FAKE_DB" || fail "write during pull lost"
grep -q '^shutdown-flushed$' "$FAKE_DB" || fail "shutdown flush lost"
ok "writes accepted while pulling are backed up and survive rollback"

step "transaction restores partial cp/mv failures and TERM; no DB restore before app start"
for injection in cp mv term; do
  cat >"$F/bin/$([[ "$injection" = mv ]] && echo mv || echo cp)" <<'INJECT'
#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do
  if [ "$arg" = ./VERSION.new ] && [ ! -f "$INJECT_ONCE" ]; then
    touch "$INJECT_ONCE"
    if [ "$INJECT_MODE" = term ]; then kill -TERM "$PPID"; sleep .1; fi
    exit 1
  fi
done
exec "/bin/$(basename "$0")" "$@"
INJECT
  chmod +x "$F/bin/$([[ "$injection" = mv ]] && echo mv || echo cp)"
  : >"$DOCKER_CALLS"
  INJECT_ONCE="$F/inject-$injection" INJECT_MODE="$injection" run ./update.sh --version 1.1.0 --yes && fail "injected $injection succeeded"
  [ "$(envv GACHIPAD_VERSION)" = 1.0.5 ] || fail "env not restored"
  [ "$(cat "$I/VERSION")" = 1.0.5 ] || fail "partial swap not restored"
  status | grep -q '"result":"rolled-back"' || fail "transaction state unclear"
  grep -q '^restored$' "$DOCKER_CALLS" && fail "restored DB before new app touched it"
  rm -f "$F/bin/cp" "$F/bin/mv"
done
ok "cp, mv (disk-full equivalent), TERM restore files and .env without unnecessary DB restore"

step "process-group INT, HUP and TERM (including a second signal during recovery)"
for signal in INT HUP TERM; do
  : >"$DOCKER_CALLS"
  FAKE_HEALTH_BLOCK_VERSION=1.1.0 FAKE_HEALTH_BLOCK="$F/signal-$signal" \
    FAKE_ROLLBACK_BLOCK_VERSION=1.0.5 FAKE_ROLLBACK_BLOCK="$F/recovery-$signal" \
    python3 - "$I" "$F/run.log" "$F/signal-$signal" "$F/recovery-$signal" "$signal" <<'SIGNAL'
import os, signal, subprocess, sys, time
install, log, gate, recovery, name = sys.argv[1:]
def until(predicate):
    deadline = time.monotonic() + 20
    while not predicate():
        if time.monotonic() > deadline: raise AssertionError("signal fixture timed out")
        time.sleep(.025)
with open(log, "w") as out:
    p = subprocess.Popen(["setsid", "./update.sh", "--version", "1.1.0", "--yes"], cwd=install, stdout=out, stderr=out)
    try:
        until(lambda: os.path.exists(gate + ".started"))
        os.killpg(p.pid, getattr(signal, "SIG" + name))
        until(lambda: os.path.exists(recovery + ".started"))
        os.killpg(p.pid, getattr(signal, "SIG" + name))
        open(recovery + ".continue", "w").close()
        assert p.wait(timeout=20) != 0
    finally:
        if p.poll() is None: os.killpg(p.pid, signal.SIGKILL); p.wait()
SIGNAL
  [ "$(envv GACHIPAD_VERSION)" = 1.0.5 ] || fail "$signal did not restore version"
  grep -q '^initial-data$' "$FAKE_DB" || fail "$signal lost data"
  grep -q '^restored$' "$DOCKER_CALLS" || fail "$signal skipped DB recovery"
  status | grep -q '"result":"rolled-back"' || fail "$signal skipped status"
  [ ! -e "$I/state/install.lock.d" ] || fail "$signal leaked lock"
done
ok "setsid process-group INT/HUP/TERM preserve tee, DB recovery and lock cleanup; repeated signals ignored"

step "an interrupted transaction refuses rerun without replacing snapshot or status"
printf 'FROM=1.0.0\nTARGET=1.1.0\nPHASE=installed\nBACKUP=backups/fixture.archive.gz\n' >"$I/state/transaction"
cp "$I/state/update.json" "$F/status-before"
sha256sum "$I/rollback/.env" >"$F/snapshot-before"
: >"$DOCKER_CALLS"
run ./update.sh --yes && fail "unfinished transaction accepted"
grep -q 'unfinished transaction' "$F/run.log" || fail "missing recovery instructions"
cmp "$I/state/update.json" "$F/status-before" || fail "unfinished status overwritten"
sha256sum -c "$F/snapshot-before" >/dev/null || fail "unfinished snapshot overwritten"
grep -q 'stop\|pull' "$DOCKER_CALLS" && fail "unfinished transaction mutated stack"
rm "$I/state/transaction"
ok "unfinished marker blocks rerun and preserves previous snapshot and status"

step "migration marker keeps help/check/scheduler controls available"
printf 'database migration\n' >"$I/state/transaction"
run ./update.sh --help || fail "migration blocks help"
run ./update.sh --check || fail "migration blocks check"
GACHIPAD_INIT=systemd GACHIPAD_SYSTEMD_DIR="$F/systemd" run ./update.sh --disable-auto || fail "migration blocks disable-auto"
GACHIPAD_INIT=systemd GACHIPAD_SYSTEMD_DIR="$F/systemd" run ./update.sh --enable-auto --dry-run || fail "migration blocks scheduler dry-run"
rm "$I/state/transaction"
ok "migration permits help/check/disable-auto/enable-auto dry-run"

step "migration marker gives snapshot recovery rather than update rollback instructions"
mkdir "$I/.env.migrate-db.recovery"
cp -p "$I/.env" "$I/.env.migrate-db.recovery/original.env"
printf 'mongodb\n' >"$I/.env.migrate-db.recovery/original.kind"
printf 'database migration\nsnapshot=.env.migrate-db.recovery\n' >"$I/state/transaction"
cp -p "$I/state/transaction" "$F/migration-marker-before"
: >"$DOCKER_CALLS"
run ./update.sh --yes && fail "unfinished migration accepted"
grep -q 'cp -p .env.migrate-db.recovery/original.env .env' "$F/run.log" || fail "migration env recipe missing"
grep -q 'cp -p .env.migrate-db.recovery/original.kind state/database-kind' "$F/run.log" || fail "migration marker recipe missing"
grep -q 'only after recovery succeeds' "$F/run.log" || fail "migration cleanup order missing"
if grep -q 'OPERATIONS 15.7' "$F/run.log"; then fail "migration directed to update rollback"; fi
cmp "$I/state/transaction" "$F/migration-marker-before" || fail "migration marker changed"
if grep -q 'stop\|pull' "$DOCKER_CALLS"; then fail "migration marker mutated stack"; fi
rm -rf "$I/.env.migrate-db.recovery" "$I/state/transaction"
ok "unfinished migration retains marker and prints exact snapshot recovery recipe"

step "offline release SHA256SUMS and a shared lock for every entry point"
# Make an offline archive whose scripts are the same transaction engine.
offline="$F/stage/gachipad-1.1.0"
images_tar "$offline/images.tar" 1.1.0
# shellcheck disable=SC2094 # manifest is excluded from find
(cd "$offline" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS)
tar czf "$F/offline.tar.gz" -C "$F/stage" gachipad-1.1.0
(cd "$F" && sha256sum offline.tar.gz >SHA256SUMS)
(cd "$I" && . ./lib.sh; install_lock; trap install_unlock EXIT; touch "$F/lock-held"; sleep 3) &
holder=$!
for _ in $(seq 100); do [ -f "$F/lock-held" ] && break; sleep .02; done
for entry in './update.sh --bundle' './upgrade.sh' './restore.sh'; do
  # Deliberate word splitting: each fixture names a command and its fixed flags.
  # shellcheck disable=SC2086
  run $entry "$F/offline.tar.gz" --yes && fail "entrypoint overlapped: $entry"
  grep -q 'another update' "$F/run.log" || fail "not blocked by lock: $entry"
done
run ./update.sh --auto && fail "auto overlapped"
grep -q 'another update' "$F/run.log" || fail "auto not blocked by lock"
wait "$holder"
step "flock reclaims a dead or pre-boot owner, but mkdir fallback remains manual"
mkdir "$I/state/install.lock.d"
printf '2147483647\n' >"$I/state/install.lock.d/owner"
run ./update.sh --check || fail "dead owner was not reclaimed under flock"
mkdir "$I/state/install.lock.d"
printf '%s\n' "$$" >"$I/state/install.lock.d/owner"
printf 'previous-boot\n' >"$I/state/install.lock.d/boot"
run ./update.sh --check || fail "previous boot owner was not reclaimed"
# Hide flock via a PATH shim for command lookup, while leaving the rest of the host available.
mkdir "$F/no-flock"
for tool in /usr/local/bin/* /usr/bin/* /bin/*; do
  [ -f "$tool" ] || continue
  [ "${tool##*/}" = flock ] || ln -sf "$tool" "$F/no-flock/${tool##*/}"
done
(cd "$I" && PATH="$F/no-flock" bash -c '. ./lib.sh; install_lock; trap install_unlock EXIT; touch "$1"; sleep 3' _ "$F/mkdir-held") &
holder=$!
for _ in $(seq 100); do [ -f "$F/mkdir-held" ] && break; sleep .02; done
PATH="$F/no-flock" run ./update.sh --version 1.1.0 --yes && fail "mkdir fallback overlapped"
wait "$holder"
[ ! -e "$I/state/install.lock.d" ] || fail "mkdir lock leaked"
mkdir "$I/state/install.lock.d"
printf '2147483647\n' >"$I/state/install.lock.d/owner"
PATH="$F/bin:$F/no-flock" run ./update.sh --check && fail "mkdir fallback reclaimed stale lock automatically"
rm "$I/state/install.lock.d/owner" && rmdir "$I/state/install.lock.d"
# Prove the bundle images are loaded from the extraction tree, with no second images.tar copy.
cat >"$F/bin/cp" <<'COPY'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in *images.tar|*/candidate/*|*/gachipad-1.1.0/.) echo 'duplicated offline image tree' >&2; exit 1 ;; esac
done
exec /bin/cp "$@"
COPY
chmod +x "$F/bin/cp"
: >"$DOCKER_CALLS"
BASH_ENV="$F/parser-env" HIDE_PARSERS=node,python3,jq PATH="$F/bin:$F/no-flock" run ./upgrade.sh "$F/offline.tar.gz" || fail "nested offline update under mkdir lock failed"
rm "$F/bin/cp"
python3 - "$DOCKER_CALLS" <<'LOAD'
import sys
s = open(sys.argv[1]).read().splitlines()
load = next(i for i, x in enumerate(s) if x.startswith("load -i "))
parsers = [i for i, x in enumerate(s) if " run --rm --no-deps --pull never" in x]
assert parsers and all(i > load and "--env-file " in s[i] for i in parsers), s
LOAD
[ "$(envv GACHIPAD_VERSION)" = 1.1.0 ] || fail "offline update version"
[ "$(envv COMPOSE_PROFILES)" = mdns,mongodb ] || fail 'upgrade changed the mDNS choice'
[ "$(envv MDNS_HOSTNAME)" = gachipad-2.local ] || fail 'upgrade changed the selected hostname'
# Fixed-list legacy updaters can omit the helper; same-version tools repair must be offline.
rm "$I/mdns.sh"
cp "$I/.env" "$F/mdns-tools.env"
# Everything outside state/ and backups/, so a repair is shown to touch nothing but mdns.sh.
tree_sums() { (cd "$I" && find . \( -path ./state -o -path ./backups \) -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum); }
tree_sums >"$F/tree.before"
: >"$DOCKER_CALLS"
: >"$FAKE_LOADED"
run ./update.sh --mdns-tools "$F/offline.tar.gz" || fail 'offline mDNS tools repair failed'
[ -x "$I/mdns.sh" ] || fail 'offline tools repair did not install helper'
cmp "$I/.env" "$F/mdns-tools.env" || fail 'tools repair changed settings'
tree_sums | grep -v '  \./mdns\.sh$' | cmp - "$F/tree.before" || fail 'tools repair changed more than mdns.sh'
calls | grep -q '^load -i ' || fail 'tools repair did not load offline image archive'
# Only the mdns image is imported: no other tag is re-pointed and no other image's files are read in.
[ "$(grep -c RepoTags "$FAKE_LOADED")" = 1 ] || fail 'tools repair loaded other image tags'
grep -qxF '"RepoTags":["ghcr.io/kim0040/gachipad-mdns:1.1.0"]' "$FAKE_LOADED" || fail 'tools repair did not load the mdns tag'
grep -q "$(digest config-mdns)" "$FAKE_LOADED" || fail 'mdns config missing from the loaded archive'
grep -q "$(digest layer-mdns)" "$FAKE_LOADED" || fail 'mdns layer missing from the loaded archive'
grep -q "$(digest config-web)\|$(digest layer-web)\|$(digest config-api)\|$(digest layer-api)" "$FAKE_LOADED" && fail 'tools repair loaded files of other images'
calls | grep -q '^compose .*\(pull\|up\|stop\)' && fail 'tools repair changed services or used registry'
# The new staged generator prints the repair command even when the old updater owns FILES.
rm "$I/mdns.sh"
mkdir -p "$F/hint/state"
cp "$I/.env" "$F/hint/.env"
GACHIPAD_LOCK_PATH="$I/state/install.lock" bash "$root/deploy/generate-secrets.sh" "$F/hint/.env" >"$F/hint.log" 2>&1
grep -q './update.sh --mdns-tools /path/to/matching-bundle.tar.gz' "$F/hint.log" || fail 'legacy first-update tools hint missing'
run ./update.sh --mdns-tools "$F/offline.tar.gz" || fail 'repeat tools repair failed'

step "--mdns-tools refuses anything but the verified, matching bundle"
# A sentinel helper makes a wrongful install visible: a refusal leaves the whole installation byte-identical.
printf '#!/bin/sh\n# sentinel helper\n' >"$I/mdns.sh"
chmod 755 "$I/mdns.sh"
tools_tree() { rm -rf "$F/tools/$1" && mkdir -p "$F/tools/$1" && cp -a "$F/stage/gachipad-1.1.0" "$F/tools/$1/"; }
tools_sums() {
  # shellcheck disable=SC2094 # manifest is excluded from find
  (cd "$F/tools/$1/gachipad-1.1.0" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum >SHA256SUMS)
}
tools_pack() {
  tar czf "$F/tools/$1/bundle.tar.gz" -C "$F/tools/$1" gachipad-1.1.0
  (cd "$F/tools/$1" && sha256sum bundle.tar.gz >bundle.tar.gz.sha256)
}
# tools_refuse CASE MESSAGE: update.sh must fail with MESSAGE, load nothing and leave the installation unchanged
tools_refuse() {
  tree_sums >"$F/tree.before"
  : >"$DOCKER_CALLS"
  run ./update.sh --mdns-tools "$F/tools/$1/bundle.tar.gz" && fail "$1: accepted"
  grep -q -- "$2" "$F/run.log" || fail "$1: expected '$2'"
  calls | grep -q '^load -i ' && fail "$1: loaded images"
  tree_sums | cmp - "$F/tree.before" || fail "$1: changed the installation"
  [ ! -e "$I/mdns.sh.new" ] || fail "$1: left mdns.sh.new"
}
tools_tree good && tools_sums good && tools_pack good
tools_tree tampered && tools_sums tampered && tools_pack tampered
printf '%s  bundle.tar.gz\n' "$(digest tampered)" >"$F/tools/tampered/bundle.tar.gz.sha256"
tools_refuse tampered 'bundle checksum mismatch'
tools_tree inner && tools_sums inner
printf '# changed\n' >>"$F/tools/inner/gachipad-1.1.0/mdns.sh"
tools_pack inner
tools_refuse inner 'bundle content checksum mismatch'
tools_tree version && printf '1.1.1\n' >"$F/tools/version/gachipad-1.1.0/VERSION" && tools_sums version && tools_pack version
tools_refuse version 'need the verified offline bundle matching the installed version'
tools_tree online && rm "$F/tools/online/gachipad-1.1.0/images.tar" && tools_sums online && tools_pack online
tools_refuse online 'need the verified offline bundle matching the installed version'
for listed in mdns.sh images.tar; do
  tools_tree "unlisted-$listed" && tools_sums "unlisted-$listed"
  sed -i "/  \.\/${listed//./\\.}\$/d" "$F/tools/unlisted-$listed/gachipad-1.1.0/SHA256SUMS"
  grep -q "$listed" "$F/tools/unlisted-$listed/gachipad-1.1.0/SHA256SUMS" && fail "fixture still lists $listed"
  tools_pack "unlisted-$listed"
  tools_refuse "unlisted-$listed" 'need the verified offline bundle matching the installed version'
done
tools_tree nomdns && images_tar "$F/tools/nomdns/gachipad-1.1.0/images.tar" 9.9.9 && tools_sums nomdns && tools_pack nomdns
tools_refuse nomdns 'has no usable ghcr.io/kim0040/gachipad-mdns:1.1.0 entry'
touch "$I/state/transaction"
tools_refuse good 'unfinished transaction'
rm "$I/state/transaction"
(cd "$I" && . ./lib.sh; install_lock; trap install_unlock EXIT; touch "$F/tools-lock-held"; sleep 3) &
holder=$!
for _ in $(seq 100); do [ -f "$F/tools-lock-held" ] && break; sleep .02; done
tools_refuse good 'another update'
wait "$holder"
# The image must exist after the load; otherwise nothing is installed.
tree_sums >"$F/tree.before"
: >"$DOCKER_CALLS"
FAKE_IMAGE_INSPECT_FAIL=1 run ./update.sh --mdns-tools "$F/tools/good/bundle.tar.gz" && fail 'accepted a load that left no mdns image'
calls | grep -q '^load -i ' || fail 'missing-image case did not reach the load'
tree_sums | cmp - "$F/tree.before" || fail 'missing mdns image changed the installation'
[ ! -e "$I/mdns.sh.new" ] || fail 'missing mdns image left mdns.sh.new'
# Mode flags and --dry-run cannot be combined with the repair, in either order.
good="$F/tools/good/bundle.tar.gz"
for args in "--dry-run --mdns-tools $good" "--mdns-tools $good --dry-run" "--mdns-tools $good --check" "--check --mdns-tools $good" \
  "--mdns-tools $good --bundle $good" "--bundle $good --mdns-tools $good" "--mdns-tools $good --auto" "--enable-auto --mdns-tools $good" \
  "--mdns-tools $good --version 1.1.1" "--mdns-tools $good --allow-major"; do
  read -ra argv <<<"$args"
  tree_sums >"$F/tree.before"
  : >"$DOCKER_CALLS"
  run ./update.sh "${argv[@]}" && fail "accepted: ${args//$good/BUNDLE}"
  grep -q 'cannot be combined' "$F/run.log" || fail "no combination message: ${args//$good/BUNDLE}"
  calls | grep -q '^load -i ' && fail "loaded images: ${args//$good/BUNDLE}"
  tree_sums | cmp - "$F/tree.before" || fail "changed the installation: ${args//$good/BUNDLE}"
done
# A layer shared with another image directory (legacy docker save) is carried along; nothing else is.
tools_tree legacy && images_tar "$F/tools/legacy/gachipad-1.1.0/images.tar" 1.1.0 legacy && tools_sums legacy && tools_pack legacy
: >"$FAKE_LOADED"
run ./update.sh --mdns-tools "$F/tools/legacy/bundle.tar.gz" || fail 'legacy layout with a shared layer was refused'
grep -qxF 'mdns/layer.tar' "$FAKE_LOADED" || fail 'mdns layer link missing from the loaded archive'
grep -qxF 'web/layer.tar' "$FAKE_LOADED" || fail 'shared layer missing from the loaded archive'
grep -q 'api' "$FAKE_LOADED" && fail 'legacy layout loaded the api image'
# The real bundle then restores the genuine helper.
run ./update.sh --mdns-tools "$F/offline.tar.gz" || fail 'tools repair after the refusals failed'
cmp "$I/mdns.sh" "$root/deploy/mdns.sh" || fail 'tools repair did not install the bundled helper'
ok "--mdns-tools: tampered, inner mismatch, wrong version, no images.tar, unlisted files, no mdns entry, marker, lock, missing image, option combinations; only the mdns image is loaded"
[ ! -e "$I/state/install.lock.d" ] || fail "nested mkdir lock leaked"
ok "flock + mkdir contention, nested offline upgrade, released SHA256SUMS (no sidecar)"

step "bounded real HTTP requests, redirect refusal, HTTPS Host and SNI arguments"
python3 - "$F/health.port" <<'HEALTH' &
import http.server, sys, time
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/stall': time.sleep(5)
        self.send_response(302 if self.path == '/redirect' else 204)
        self.end_headers()
    def log_message(self, *args): pass
s=http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
open(sys.argv[1], 'w').write(str(s.server_port))
s.serve_forever()
HEALTH
health=$!
for _ in $(seq 100); do [ -s "$F/health.port" ] && break; sleep .02; done
hp="$(cat "$F/health.port")"
(
  cd "$I"; . ./lib.sh
  env_set HTTP_PORT "$hp"
  SECONDS=0
  wait_healthy 1 /stall && exit 1
  [ "$SECONDS" -le 2 ] || exit 1
  wait_healthy 1 /redirect && exit 1
  wait_healthy 3 /ok || exit 1
) >"$F/health.log" 2>&1 || fail "bounded health checks"
kill "$health"
cat >"$F/bin/curl" <<'CURL'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$HEALTH_CALLS"
printf 204
CURL
chmod +x "$F/bin/curl"
HEALTH_CALLS="$F/health.args" run bash -c '. ./lib.sh; env_set SITE_ADDRESS https://gachipad.corp; env_set HTTPS_PORT 8443; wait_healthy 3 /readyz' || fail "HTTPS health"
grep -q -- '--resolve gachipad.corp:8443:127.0.0.1.*--connect-timeout 3 --max-time 3.*https://gachipad.corp:8443/readyz' "$F/health.args" || fail "Host/SNI or bounded timeout missing"
rm "$F/bin/curl"
ok "stalled response bounded, 302 refused, only 2xx accepted, correct HTTPS origin/SNI"

step "unsupported scheduler paths fail before modifying systemd or cron"
for suffix in 'with space' "apostrophe'path" 'percent%path'; do
  special="$F/$suffix"
  mkdir "$special"
  cp "$I"/{update.sh,lib.sh,.env} "$special/"
  for init in systemd cron; do
    (cd "$special" && GACHIPAD_INIT="$init" ./update.sh --enable-auto --dry-run) >"$F/run.log" 2>&1 && fail "accepted scheduler path $suffix"
    grep -q 'automatic updates require an install path' "$F/run.log" || fail "path refusal message"
  done
done
ok "space, apostrophe, percent refused for both schedulers"

step "a source checkout is not updated in place"
mkdir -p "$F/checkout/deploy" && touch "$F/checkout/package.json" && mkdir "$F/checkout/.git"
cp -r "$I"/. "$F/checkout/deploy/"
(cd "$F/checkout/deploy" && ./update.sh --yes) >"$F/run.log" 2>&1 && fail "updated a source checkout"
grep -q 'source checkout' "$F/run.log" || fail "checkout message"
ok "refused with the git pull / docker compose build hint"

step "a partly opened ingress must not trigger a DB rollback that discards accepted writes"
: >"$DOCKER_CALLS"
FAKE_INGRESS_FAIL=1.1.1 run ./update.sh --version 1.1.1 --yes && fail "failed ingress reported success"
[ "$(envv GACHIPAD_VERSION)" = 1.1.1 ] || fail "verified version was put back after ingress opened"
grep -q '^accepted-at-ingress$' "$FAKE_DB" || fail "write accepted while ingress opened was lost"
grep -q '^restored$' "$DOCKER_CALLS" && fail "restored an old DB after ingress could accept writes"
status | grep -q 'current files and DB retained' || fail "ingress recovery state unclear"
ok "ingress activation failure stops writers and retains current DB and files for recovery"


step "SQLite snapshots use the data filesystem and clean up success and failure paths"
sqlite_fixture="$F/sqlite-files"
mkdir -p "$sqlite_fixture/data" "$sqlite_fixture/work"
cat >"$sqlite_fixture/check-files.mjs" <<'JS'
import fs from "node:fs";
import { dirname } from "node:path";
import { syncBuiltinESMExports } from "node:module";
const root = process.env.SQLITE_DATA;
for (const name of ["mkdtempSync", "createReadStream", "createWriteStream"]) {
  const original = fs[name];
  fs[name] = (path, ...args) => {
    if (!String(path).startsWith(`${root}/`)) throw new Error("SQLite temporary file escaped data volume");
    if (name === "mkdtempSync" && dirname(path) !== root) throw new Error("snapshot is not a sibling");
    if (name === "createWriteStream" && process.env.SQLITE_FAIL_WRITE) throw new Error("injected write failure");
    if (name === "createReadStream" && process.env.SQLITE_FAIL_READ) throw new Error("injected read failure");
    if (name === "createWriteStream" && String(path).endsWith(".restore")) {
      fs.writeFileSync(`${root}/custom.db-wal`, "stale fixture WAL");
      fs.writeFileSync(`${root}/custom.db-shm`, "stale fixture SHM");
    }
    return original(path, ...args);
  };
}
if (process.env.SQLITE_NO_SPACE) fs.statfsSync = () => ({ bavail: 0n, bsize: 4096n });
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (fs.existsSync(`${to}-wal`) || fs.existsSync(`${to}-shm`)) throw new Error("stale WAL before rename");
  return rename(from, to);
};
syncBuiltinESMExports();
JS
# shellcheck disable=SC2016 # SQLite fixture paths are expanded by node
SQLITE_DATA="$sqlite_fixture/data" node --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  const db = new DatabaseSync(`${process.env.SQLITE_DATA}/custom.db`);
  db.exec("CREATE TABLE fixture (data BLOB); INSERT INTO fixture VALUES (randomblob(1048576))");
  db.close();
' >/dev/null 2>&1
(
  cd "$sqlite_fixture/work"
  # shellcheck source=/dev/null
  source "$I/lib.sh"
  export SQLITE_DATA="$sqlite_fixture/data"
  # shellcheck disable=SC2317 # backend helpers call this process-boundary replacement
  docker() {
    while [ "$1" != --entrypoint ]; do
      if [ "$1" = -e ]; then export "${2?}"; shift; fi
      shift
    done
    while [ "$1" != -e ]; do shift; done
    shift
    DATABASE_URL="sqlite:$SQLITE_DATA/custom.db" node --import "$sqlite_fixture/check-files.mjs" --input-type=module -e "$1"
  }
  mkdir "$SQLITE_DATA/.gachipad-backup-stale" "$SQLITE_DATA/.gachipad-validate-stale"
  touch "$SQLITE_DATA/custom.db.restore" "$SQLITE_DATA/unrelated.restore"
  sqlite_backup backups >snapshot.log
  [ ! -e "$SQLITE_DATA/.gachipad-backup-stale" ] && [ ! -e "$SQLITE_DATA/.gachipad-validate-stale" ]
  [ ! -e "$SQLITE_DATA/custom.db.restore" ]
  archive="$(sed -n 's/^backup: \(.*\) (.*/\1/p' snapshot.log)"
  sqlite_validate "$archive"
  sqlite_restore "$archive"
  if SQLITE_NO_SPACE=1 sqlite_backup no-space >space.log 2>&1; then exit 1; fi
  grep -q 'SQLite data filesystem has insufficient free space' space.log
  if SQLITE_NO_SPACE=1 sqlite_validate "$archive" >space.log 2>&1; then exit 1; fi
  grep -q 'SQLite data filesystem has insufficient free space' space.log
  if SQLITE_FAIL_READ=1 sqlite_backup failed-read; then exit 1; fi
  if SQLITE_FAIL_WRITE=1 sqlite_validate "$archive"; then exit 1; fi
  gzip -c </dev/null >empty.gz
  if sqlite_validate empty.gz; then exit 1; fi
  [ -f "$SQLITE_DATA/unrelated.restore" ]
  rm "$SQLITE_DATA/unrelated.restore"
  [ -z "$(find "$SQLITE_DATA" -name '.gachipad-*' -o -name '*.restore')" ]
) >"$F/sqlite-files.log" 2>&1 || { cat "$F/sqlite-files.log" >&2; fail "SQLite data-volume temporary file checks"; }
ok "SQLite sibling snapshots, streamed output, validation/error cleanup and WAL removal before rename"

printf '\nupdate.test.sh: all checks passed\n'
