#!/usr/bin/env bash
# Updates an installed gachipad to a newer GitHub release (docs/OPERATIONS.md "업데이트").
#
#   ./update.sh --check                  installed and newest release; changes nothing
#   ./update.sh [--yes]                  the newest release (refuses a new major version)
#   ./update.sh --version 1.4.2          that release
#   ./update.sh --allow-major            also across a major version; read its notes first
#   ./update.sh --mdns-tools <file.tar.gz>  install optional tools/images from a matching offline bundle
#   ./update.sh --bundle <file.tar.gz>   no internet: the offline path, ./upgrade.sh <file>
#   ./update.sh --enable-auto [--at 04:00] [--policy patch|minor]    opt-in daily updates
#   ./update.sh --disable-auto
#   ./update.sh --auto                   what the timer runs: only what the policy allows
#   --dry-run                            with --enable-auto / --disable-auto: print, change nothing
#
# Online: release list -> SHA256SUMS -> gachipad-deploy-<v>.tar.gz checked against it -> its own
# SHA256SUMS -> staged files -> pull/load + image digests -> close ingress -> stop writers -> backup
# (IMAGES) -> up -d -> /healthz and /readyz. If the new version does not get healthy, the previous
# files and version come back, the DB backup is restored with writers stopped, then the previous
# images (still on the host) start and pass readiness before ingress opens. Every run is logged to state/update.log; state/update.json is what the admin console shows.
#
# Settings, from the environment or .env: UPDATE_REPO (kim0040/gachipad), UPDATE_CHANNEL (stable or
# prerelease), UPDATE_API_URL (https://api.github.com), UPDATE_DOWNLOAD_URL (https://github.com),
# UPDATE_HEALTH_TIMEOUT (180 s). No credentials: the release API and the images are public.
set -euo pipefail
trap '' PIPE
umask 077
cd "$(dirname "$0")"
. ./lib.sh
declare -F assert_readable_env >/dev/null || die 'lib.sh is older than this script'

STATE=state
LOG="$STATE/update.log"
STATUS="$STATE/update.json"
LAST_RUN="$STATE/last-run"
AUTO_CONF="$STATE/auto.conf"
ROLLBACK=rollback
MARKER="$STATE/transaction"
UNIT=gachipad-update
SYSTEMD_DIR="${GACHIPAD_SYSTEMD_DIR:-/etc/systemd/system}"
# legacy codesh name (1.0.x); remove in 2.0
# An existing scheduler keeps its installed unit/tag, avoiding two timers after the update.
# A host that never had one gets the new name, even when the installation itself is legacy.
if [ -f "$SYSTEMD_DIR/codesh-update.timer" ] ||
  { command -v crontab >/dev/null 2>&1 && grep -qF "# codesh-update $(pwd)" < <(crontab -l 2>/dev/null); }; then
  UNIT=codesh-update
fi
CRON_TAG="# $UNIT $(pwd)"
FILES="docker-compose.yml .env.example VERSION lib.sh preflight.sh generate-secrets.sh install.sh upgrade.sh update.sh backup.sh restore.sh migrate-db.sh mdns.sh README.md"

usage() { sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p;}' "$0"; }

say() { printf '%s update: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" || true; }

# setting NAME default: the environment wins over .env
setting() {
  local value="${!1:-}"
  [ -n "$value" ] || value="$(env_get "$1")"
  printf '%s' "${value:-$2}"
}

# --- versions ------------------------------------------------------------------------------------

# semver_ok v: a release (1.2.3) or pre-release (1.2.3-rc.1) version
semver_ok() {
  [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]] || return 1
  local pre="${1#*-}" id
  [ "$pre" != "$1" ] || return 0
  local -a identifiers
  IFS=. read -ra identifiers <<<"$pre"
  for id in "${identifiers[@]}"; do
    [[ "$id" =~ ^[0-9]+$ && "$id" == 0?* ]] && return 1
  done
  return 0
}
major() { printf '%s' "${1%%.*}"; }
minor() { local rest="${1#*.}"; printf '%s' "${rest%%.*}"; }

# version_gt a b: a is newer than b (a release is newer than its own pre-releases)
version_gt() {
  [ "$1" = "$2" ] && return 1
  local a="${1%%-*}" b="${2%%-*}"
  if [ "$a" != "$b" ]; then
    [ "$(printf '%s\n%s\n' "$a" "$b" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)" = "$a" ]
    return
  fi
  [ "$1" = "$a" ] && return 0
  [ "$2" = "$b" ] && return 1
  local -a left right
  local i l r
  IFS=. read -ra left <<<"${1#*-}"
  IFS=. read -ra right <<<"${2#*-}"
  for ((i=0; i<${#left[@]}; i++)); do
    [ "$i" -lt "${#right[@]}" ] || return 0
    l="${left[i]}"; r="${right[i]}"
    [ "$l" != "$r" ] || continue
    if [[ "$l" =~ ^[0-9]+$ && "$r" =~ ^[0-9]+$ ]]; then
      [ "${#l}" -gt "${#r}" ] && return 0
      [ "${#l}" -lt "${#r}" ] && return 1
    elif [[ "$l" =~ ^[0-9]+$ ]]; then return 1
    elif [[ "$r" =~ ^[0-9]+$ ]]; then return 0; fi
    LC_ALL=C sort -C <<<"$(printf '%s\n%s' "$r" "$l")"
    return
  done
  return 1
}

# --- downloads -----------------------------------------------------------------------------------

# fetch url file [seconds]: GET without credentials or cookies; FETCH_STATUS is the HTTP status
fetch() {
  FETCH_STATUS=""
  if command -v curl >/dev/null 2>&1; then
    FETCH_STATUS="$(curl -fsSL --proto '=https,http' --max-time "${3:-30}" -A "gachipad-update/$CURRENT" \
      -H 'Accept: application/vnd.github+json' -o "$2" -w '%{http_code}' "$1")"
  else
    # -S prints the response headers to stderr; the last status line is the final response.
    local status=0
    wget -q -S -T "${3:-30}" -U "gachipad-update/$CURRENT" -O "$2" "$1" 2>"$2.headers" || status=$?
    FETCH_STATUS="$(awk '$1 ~ /^HTTP\// { code = $2 } END { print code }' "$2.headers" 2>/dev/null)"
    rm -f "$2.headers"
    return "$status"
  fi
}

# Prefer an available host parser, otherwise use the installed (or loaded bundle) API image.
parse_json() {
  if command -v node >/dev/null 2>&1; then node -e "$2" "$CHANNEL"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, re, sys
data = json.load(sys.stdin)
if sys.argv[1] == "mongo":
    print(data["services"]["mongo"]["image"])
else:
    for r in data if isinstance(data, list) else [data]:
        if not isinstance(r, dict) or not isinstance(r.get("tag_name"), str): continue
        if any(k in r and type(r[k]) is not bool for k in ("draft", "prerelease")) or r.get("draft"): continue
        v = r["tag_name"].strip()
        if v.startswith("v"): v = v[1:]
        m = re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?", v)
        if not m or any(int(n) > 9007199254740991 for n in m.group(1, 2, 3)): continue
        if m[4] and any(n.isascii() and n.isdigit() and (len(n) > 1 and n[0] == "0" or int(n) > 9007199254740991) for n in m[4].split(".")): continue
        if sys.argv[2] != "prerelease" and (r.get("prerelease") or m[4]): continue
        print(v.split("+")[0])
' "$1" "$CHANNEL"
  elif command -v jq >/dev/null 2>&1; then
    if [ "$1" = mongo ]; then jq -er '.services.mongo.image | select(type == "string" and length > 0)'
    else
      jq -r --arg channel "$CHANNEL" '
        (if type == "array" then .[] else . end) | select(type == "object") |
        select(((has("draft") | not) or (.draft | type) == "boolean") and
          ((has("prerelease") | not) or (.prerelease | type) == "boolean") and .draft != true) |
        select(.tag_name | type == "string") | . as $r |
        (.tag_name | gsub("^\\s+|\\s+$"; "") | sub("^v"; "")) as $v |
        (try ($v | capture("^(?<a>0|[1-9][0-9]*)\\.(?<b>0|[1-9][0-9]*)\\.(?<c>0|[1-9][0-9]*)(?:-(?<pre>[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$")) catch empty) |
        select([.a,.b,.c] | all(tonumber <= 9007199254740991)) |
        select((.pre // "" | split(".")) | all(if test("^[0-9]+$") then
          (test("^0[0-9]") | not) and tonumber <= 9007199254740991 else true end)) |
        select($channel == "prerelease" or ($r.prerelease != true and (.pre // "") == "")) |
        $v | split("+")[0]'
    fi
  elif [ -n "$BUNDLE" ]; then
    candidate run --rm --no-deps --pull never -T --entrypoint node api -e "$2" "$CHANNEL"
  else
    docker compose run --rm --no-deps --pull never -T --entrypoint node api -e "$2" "$CHANNEL"
  fi
}

# Same tag syntax/channel rules as the API (drafts, flag-only prereleases, numeric identifiers).
releases() {
  local file="$WORK/releases.json"
  fetch "$API/repos/$REPO/releases?per_page=50" "$file" || {
    case "${FETCH_STATUS:-}" in
      403 | 429) say "GitHub refused the release list (HTTP $FETCH_STATUS), usually because this public IP used up its 60 requests an hour without a login; try again in an hour (the timer retries tomorrow)" >&2 ;;
      [1-9][0-9][0-9]) say "cannot fetch release list from $API (HTTP $FETCH_STATUS); check UPDATE_REPO or use --bundle" >&2 ;;
      *) say "cannot fetch release list from $API; check connectivity or use --bundle" >&2 ;;
    esac
    return 1;
  }
  parse_json releases '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    for (const r of Array.isArray(data) ? data : [data]) {
      if (!r || typeof r.tag_name !== "string" || r.draft === true) continue;
      if (r.draft !== undefined && typeof r.draft !== "boolean") continue;
      if (r.prerelease !== undefined && typeof r.prerelease !== "boolean") continue;
      const v = r.tag_name.trim().replace(/^v/, "");
      const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(v);
      if (!m || m.slice(1, 4).some(n => !Number.isSafeInteger(Number(n)))) continue;
      if (m[4]?.split(".").some(n => /^\d+$/.test(n) && (n.length > 1 && n[0] === "0" || !Number.isSafeInteger(Number(n))))) continue;
      if (process.argv[1] !== "prerelease" && (r.prerelease === true || m[4])) continue;
      console.log(v.split("+")[0]);
    }
  ' <"$file" || {
    say "cannot parse release JSON; install host node/python3/jq or load the installed API image" >&2; return 1;
  }
}

# newest <list> <policy>: the newest version above CURRENT the policy allows (any|major|patch|minor)
newest() {
  local best="" v
  for v in $1; do
    version_gt "$v" "$CURRENT" || continue
    case "$2" in
      patch) [ "$(major "$v").$(minor "$v")" = "$(major "$CURRENT").$(minor "$CURRENT")" ] || continue ;;
      minor | major) [ "$(major "$v")" = "$(major "$CURRENT")" ] || continue ;;
    esac
    if [ -z "$best" ] || version_gt "$v" "$best"; then best="$v"; fi
  done
  printf '%s' "$best"
}

# --- status for the admin console ----------------------------------------------------------------

json_str() {
  [ -n "$1" ] || { printf 'null'; return; }
  local s="${1:0:300}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$(printf '%s' "$s" | tr -d '\000-\037')"
}

write_status() {
  local auto="null" AT="" POLICY="" LAST_AT="" LAST_RESULT="" LAST_FROM="" LAST_TO="" LAST_MESSAGE=""
  # shellcheck disable=SC1090
  [ -f "$AUTO_CONF" ] && . "$AUTO_CONF"
  [ -f "$AUTO_CONF" ] && auto="{\"enabled\":true,\"at\":$(json_str "$AT"),\"policy\":$(json_str "$POLICY")}"
  [ -f "$AUTO_CONF" ] || auto='{"enabled":false,"at":null,"policy":null}'
  # shellcheck disable=SC1090
  [ -f "$LAST_RUN" ] && . "$LAST_RUN"
  local last="null"
  [ -n "$LAST_AT" ] && last="{\"at\":\"$LAST_AT\",\"result\":\"$LAST_RESULT\",\"from\":$(json_str "$LAST_FROM"),\"to\":$(json_str "$LAST_TO"),\"message\":$(json_str "$LAST_MESSAGE")}"
  printf '{"auto":%s,"lastRun":%s}\n' "$auto" "$last" >"$STATUS.tmp" || return 1
  # api runs as another user and mounts state/ read-only.
  chmod 644 "$STATUS.tmp" || return 1
  mv "$STATUS.tmp" "$STATUS" || return 1
}

# record result from to message (not for --check, which changes nothing)
record() {
  [ "$MODE" = check ] && return 0
  {
    printf 'LAST_AT=%q\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'LAST_RESULT=%q\nLAST_FROM=%q\nLAST_TO=%q\nLAST_MESSAGE=%q\n' "$1" "${2:-}" "${3:-}" "${4:-}"
  } >"$LAST_RUN" || return 1
  write_status || return 1
  RECORDED=1
}

# fail result message: records, logs and exits (1, or 3 for a refusal)
fail() {
  record "$1" "$CURRENT" "${TARGET:-}" "$2" || true
  say "$2" >&2
  [ "$1" = refused ] && exit 3
  exit 1
}

# --- automatic updates ---------------------------------------------------------------------------

init_system() {
  if [ -n "${GACHIPAD_INIT:-}" ]; then printf '%s' "$GACHIPAD_INIT"
  elif [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then printf systemd
  else printf cron; fi
}

# run cmd...: runs it, or prints it with --dry-run
run() {
  if [ "$DRY" = 1 ]; then printf 'dry-run: %s\n' "$*"; else "$@"; fi
}

# put file content: writes it, or prints it with --dry-run
put() {
  if [ "$DRY" = 1 ]; then printf 'dry-run: write %s:\n%s\n' "$1" "$2"; else printf '%s\n' "$2" >"$1" && chmod 644 "$1"; fi
}

enable_auto() {
  [[ "$AT" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "--at needs HH:MM, for example 04:00"
  [ "$POLICY" = patch ] || [ "$POLICY" = minor ] || die "--policy is patch or minor"
  local dir init
  dir="$(pwd)"
  # Both scheduler grammars have special quoting/specifier rules. Keep one explicit path contract.
  [[ "$dir" =~ ^/[a-zA-Z0-9_./-]+$ ]] || die "automatic updates require an install path containing only letters, digits, / . _ and -"
  init="$(init_system)"
  if [ "$init" = systemd ]; then
    [ "$DRY" = 1 ] || [ -w "$SYSTEMD_DIR" ] || die "writing $SYSTEMD_DIR needs root: sudo ./update.sh --enable-auto ..."
    put "$SYSTEMD_DIR/$UNIT.service" "[Unit]
Description=gachipad automatic update ($dir)
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
KillMode=mixed
TimeoutStopSec=30min
ExecStart=$dir/update.sh --auto"
    put "$SYSTEMD_DIR/$UNIT.timer" "[Unit]
Description=Daily gachipad update window

[Timer]
OnCalendar=*-*-* $AT:00
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target"
    run systemctl daemon-reload
    run systemctl enable --now "$UNIT.timer"
  else
    command -v crontab >/dev/null 2>&1 || die "neither systemd nor crontab is available"
    local line="$((10#${AT#*:})) $((10#${AT%:*})) * * * cd '$dir' && ./update.sh --auto >/dev/null 2>&1 $CRON_TAG"
    if [ "$DRY" = 1 ]; then
      printf 'dry-run: crontab entry: %s\n' "$line"
    else
      { crontab -l 2>/dev/null | grep -vF "$CRON_TAG" || true; printf '%s\n' "$line"; } | crontab -
    fi
  fi
  put "$AUTO_CONF" "AT=$AT
POLICY=$POLICY
VIA=$init"
  [ "$DRY" = 1 ] && return
  write_status
  say "automatic updates on: daily at $AT ($init), policy $POLICY"
}

disable_auto() {
  local init
  init="$(init_system)"
  if [ "$init" = systemd ]; then
    if [ -f "$SYSTEMD_DIR/$UNIT.timer" ] || [ "$DRY" = 1 ]; then
      run systemctl disable --now "$UNIT.timer"
      run rm -f "$SYSTEMD_DIR/$UNIT.timer" "$SYSTEMD_DIR/$UNIT.service"
      run systemctl daemon-reload
    fi
  elif command -v crontab >/dev/null 2>&1; then
    if [ "$DRY" = 1 ]; then
      printf 'dry-run: remove the crontab entry ending in "%s"\n' "$CRON_TAG"
    else
      { crontab -l 2>/dev/null | grep -vF "$CRON_TAG" || true; } | crontab -
    fi
  fi
  run rm -f "$AUTO_CONF"
  [ "$DRY" = 1 ] && return
  write_status
  say "automatic updates off"
}

# --- the update ----------------------------------------------------------------------------------

# Stage every required file before changing the installation. Explicit checks also apply when
# the caller tests a function's return value (where bash disables errexit).
install_files() {
  local file
  for file in $FILES .env; do
    [ -f "$1/$file" ] || { say "missing required file: $file" >&2; return 1; }
    cp -p "$1/$file" "./$file.new" || return 1
    mv "./$file.new" "./$file" || return 1
  done
  if [ -f "$1/IMAGES" ]; then
    cp "$1/IMAGES" ./IMAGES.new && mv ./IMAGES.new ./IMAGES || return 1
  else rm -f IMAGES || return 1; fi
  mkdir -p docs tls || return 1
  for file in "$1"/docs/*; do
    [ -f "$file" ] || continue
    cp "$file" docs/ || return 1
  done
  for file in "$1"/tls/*.example; do
    [ -f "$file" ] || continue
    [ -e "tls/${file##*/}" ] || cp "$file" tls/ || return 1
  done
}

# shellcheck disable=SC2317 # invoked through the EXIT trap
restore_files() {
  local file
  for file in $FILES .env IMAGES docs tls; do
    if [ -e "$ROLLBACK/$file" ]; then
      rm -rf "./$file" || return 1
      cp -a "$ROLLBACK/$file" "./$file" || return 1
    else rm -rf "./$file" || return 1; fi
    rm -f "./$file.new" || return 1
  done
}

# All Compose reads of the candidate use the installed project directory (secrets, volumes,
# certificates) but its staged env and compose file. No installed files change during pull.
candidate() {
  docker compose --project-directory "$PWD" --env-file "$CANDIDATE/.env" -f "$CANDIDATE/docker-compose.yml" "$@"
}

candidate_merge_env() {
  local name
  while read -r name; do
    case "$name" in
      GACHIPAD_DB | GACHIPAD_DATABASE_URL | COMPOSE_PROFILES) continue ;;
    esac
    grep -q "^$name=" .env || sed -n "s/^$name=.*/&/p" .env.example >>.env
  done < <(sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' .env.example)
}

mongo_compatible() {
  local old new
  old="$(docker compose config --format json | mongo_image)" || return 2
  new="$(candidate config --format json | mongo_image)" || return 2
  # Conservatively reject ANY mongo image change; even a minor change can alter FCV/on-disk data.
  if [ -z "$old" ] || [ "$old" != "$new" ]; then
    say "MongoDB image change ($old -> $new) needs a separately supported migration path" >&2; return 1
  fi
}

mongo_image() {
  parse_json mongo '
    const c = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (!c.services?.mongo?.image) process.exit(1);
    console.log(c.services.mongo.image);
  '
}

# verify_images: the pulled images are the ones the release built (IMAGES: name sha256:digest)
verify_images() {
  [ -f "$CANDIDATE/IMAGES" ] || { say "no IMAGES list in this release; image digests not checked"; return 0; }
  local name digest ref registry
  registry="$(setting GACHIPAD_REGISTRY ghcr.io/kim0040)"
  while read -r name digest; do
    [ -n "$name" ] || continue
    ref="$registry/$name:$TARGET"
    # Only images this installation uses (mdns is optional).
    candidate config --images | grep -qxF "$ref" || continue
    docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$ref" | grep -q "@$digest\$" ||
      { say "$ref is not the released image $digest" >&2; return 1; }
  done <"$CANDIDATE/IMAGES"
}

healthy() {
  case "$(database_kind)" in
    mongodb) docker compose up -d --wait --wait-timeout "$HEALTH_TIMEOUT" mongo mongo-users valkey api collab ;;
    postgres) docker compose up -d --wait --wait-timeout "$HEALTH_TIMEOUT" postgres valkey api collab ;;
    sqlite | external) docker compose up -d --wait --wait-timeout "$HEALTH_TIMEOUT" valkey api collab ;;
  esac && wait_api "$HEALTH_TIMEOUT"
}

open_ingress() {
  docker compose up -d --wait --wait-timeout "$HEALTH_TIMEOUT"
}

# shellcheck disable=SC2317 # invoked through the EXIT trap
rollback() {
  say "gachipad $TARGET failed: rolling back to $CURRENT"
  # Never run the old application against the failed release's DB. Keep ingress closed.
  docker compose stop caddy || return 1
  docker compose stop --timeout 40 api collab || return 1
  restore_files || return 1
  if [ "$DB_TOUCHED" = 1 ]; then
    if [ "$(database_kind)" = external ]; then
      say "external database was not restored; restore its external backup before starting the previous application"
      say "after restoring the external backup, run: cd $(printf '%q' "$(pwd -P)") && docker compose up -d --wait --wait-timeout $HEALTH_TIMEOUT && rm -f state/transaction"
      return 1
    fi
    [ -n "$BACKUP" ] || return 1
    [ -s "$BACKUP" ] || return 1
    database_start "$HEALTH_TIMEOUT" || return 1
    say "restoring the database from $BACKUP before starting $CURRENT"
    database_restore "$BACKUP" || return 1
  fi
  healthy && open_ingress || return 1
  rm -f "$MARKER" || say "warning: cannot clear $MARKER; remove it after verifying recovery" >&2
  record rolled-back "$CURRENT" "$TARGET" "previous files restored; DB restore required: $DB_TOUCHED; back on $CURRENT" ||
    say "warning: recovery complete but status could not be written" >&2
  say "rolled back: gachipad $CURRENT is running"
}

# shellcheck disable=SC2317 # invoked through the EXIT trap
cleanup() {
  local result=$?
  # Always release the lock, including when a status or temporary-file write fails.
  trap - EXIT
  trap '' HUP INT TERM
  set +e
  if [ "${TRANSACTION:-0}" = 1 ]; then
    if ! rollback; then
      docker compose stop caddy api collab || true
      record failed "$CURRENT" "$TARGET" "recovery failed; ingress and writers stopped; keep rollback and $BACKUP; inspect $LOG" || true
      say "recovery failed; ingress remains closed; see $LOG" >&2
    fi
    result=1
  fi
  if [ "$result" != 0 ] && [ "${RECORDED:-0}" = 0 ] && [ "${DRY:-0}" != 1 ] && [ -n "${CURRENT:-}" ]; then
    record failed "$CURRENT" "${TARGET:-}" "update aborted before maintenance; installed files unchanged; see $LOG" || true
  fi
  [ -z "${WORK:-}" ] || rm -rf "$WORK" || true
  install_unlock
  exit "$result"
}

transaction_phase() {
  {
    printf 'FROM=%q\nTARGET=%q\nPHASE=%q\nBACKUP=%q\n' "$CURRENT" "$TARGET" "$1" "$BACKUP"
  } >"$MARKER.tmp" && mv "$MARKER.tmp" "$MARKER"
}

update() {
  local mode="$1" list src=""
  [ -f .env ] || die "no .env here: this is not an installed gachipad"
  if [ -e ../.git ] && [ -f ../package.json ] && [ "$mode" != check ]; then
    die "this is a source checkout: update it with git pull && docker compose build && docker compose up -d"
  fi
  if [ "$mode" != check ]; then
    assert_database_backend
    if [ "$(database_kind)" = external ] && [ "${GACHIPAD_EXTERNAL_BACKUP_CONFIRMED:-$(env_get GACHIPAD_EXTERNAL_BACKUP_CONFIRMED)}" != 1 ]; then
      fail refused "DATABASE_URL uses an external database; back up that server first, then rerun with GACHIPAD_EXTERNAL_BACKUP_CONFIRMED=1"
    fi
  fi
  if [ -n "$BUNDLE" ]; then
    verify_archive "$BUNDLE"
    mkdir "$WORK/x"
    tar --no-same-owner -xzf "$BUNDLE" -C "$WORK/x"
    src="$(find "$WORK/x" -maxdepth 2 -name images.tar -exec dirname {} \; | head -n 1)"
    [ -n "$src" ] || fail failed "not an offline gachipad bundle"
    (verify_bundle "$src") || fail failed "bundle content checksum mismatch"
    TARGET="$(cat "$src/VERSION")"
  fi
  if [ -z "$TARGET" ]; then
    semver_ok "$CURRENT" || die "installed version '$CURRENT' is not a release; pass --version X.Y.Z"
    list="$(releases)" || fail failed "release discovery failed; see the connectivity or JSON parser error above"
    case "$mode" in
      auto) TARGET="$(newest "$list" "$AUTO_POLICY")" ;;
      *)
        TARGET="$(newest "$list" any)"
        local same
        same="$(newest "$list" major)"
        if [ "$mode" = check ]; then
          say "installed $CURRENT, newest ${TARGET:-$CURRENT} (channel $CHANNEL, $REPO)"
          if [ -z "$TARGET" ]; then say "up to date"
          elif [ "$(major "$TARGET")" != "$(major "$CURRENT")" ] && [ -n "$same" ]; then
            say "update with ./update.sh (to $same) or ./update.sh --allow-major (to $TARGET)"
          elif [ "$(major "$TARGET")" != "$(major "$CURRENT")" ]; then
            say "update with ./update.sh --allow-major (to $TARGET); read its release notes first"
          else say "update with ./update.sh (to $TARGET)"; fi
          return 0
        fi
        if [ -n "$TARGET" ] && [ "$(major "$TARGET")" != "$(major "$CURRENT")" ] && [ "$ALLOW_MAJOR" != 1 ]; then
          if [ -n "$same" ]; then
            say "$TARGET is a new major version; updating to $same, the newest $(major "$CURRENT").x (--allow-major for $TARGET)"
            TARGET="$same"
          else
            fail refused "$TARGET is a new major version: read its release notes, then ./update.sh --allow-major"
          fi
        fi
        ;;
    esac
  else
    semver_ok "$TARGET" || die "--version needs X.Y.Z"
    if semver_ok "$CURRENT" && [ "$(major "$TARGET")" != "$(major "$CURRENT")" ] && [ "$ALLOW_MAJOR" != 1 ]; then
      fail refused "$TARGET is a new major version: read its release notes, then add --allow-major"
    fi
    if semver_ok "$CURRENT" && ! version_gt "$TARGET" "$CURRENT" && [ "$TARGET" != "$CURRENT" ]; then
      fail refused "$TARGET is older than $CURRENT: go back with ./restore.sh and the backup instead"
    fi
  fi
  if [ -z "$TARGET" ] || [ "$TARGET" = "$CURRENT" ]; then
    [ "$mode" = check ] || record up-to-date "$CURRENT" "$CURRENT" ""
    say "gachipad $CURRENT is up to date"
    return 0
  fi
  if [ "$mode" = check ]; then say "installed $CURRENT, available $TARGET"; return 0; fi

  if [ "$YES" != 1 ]; then
    [ -t 0 ] || die "add --yes to update without a terminal"
    read -r -p "Update gachipad $CURRENT -> $TARGET? [y/N] " answer
    [ "$answer" = y ] || [ "$answer" = Y ] || die "cancelled"
  fi

  say "updating $CURRENT -> $TARGET"
  if [ -z "$src" ]; then
    local base="$DOWNLOAD/$REPO/releases/download/v$TARGET" asset="gachipad-deploy-$TARGET.tar.gz" expected
    fetch "$base/SHA256SUMS" "$WORK/SHA256SUMS" || fail failed "cannot download SHA256SUMS of v$TARGET"
    expected="$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$WORK/SHA256SUMS" | head -n 1)"
    [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail failed "SHA256SUMS of v$TARGET does not list $asset"
    fetch "$base/$asset" "$WORK/$asset" 600 || fail failed "cannot download $asset"
    [ "$(sha256_file "$WORK/$asset")" = "$expected" ] || fail failed "checksum mismatch: $asset is not the released file"
    mkdir "$WORK/x"
    tar --no-same-owner -xzf "$WORK/$asset" -C "$WORK/x"
    src="$(find "$WORK/x" -maxdepth 2 -name docker-compose.yml -exec dirname {} \; | head -n 1)"
    [ -n "$src" ] || fail failed "$asset is not a gachipad release"
    (verify_bundle "$src") || fail failed "content checksum mismatch in $asset"
    [ "$(cat "$src/VERSION")" = "$TARGET" ] || fail failed "$asset has the wrong VERSION"
  fi

  # The extracted tree is already verified. Reuse it instead of duplicating images.tar in TMPDIR.
  CANDIDATE="$src"
  cp -p .env "$CANDIDATE/.env"
  (
    cd "$CANDIDATE"
    candidate_merge_env
    ./generate-secrets.sh .env >/dev/null
    env_set GACHIPAD_VERSION "$TARGET"
    if [ -n "$BUNDLE" ]; then
      registry="$(sed -n 's/^GACHIPAD_REGISTRY=//p' .env.example | tail -n 1)"
      [ -z "$registry" ] || env_set GACHIPAD_REGISTRY "$registry"
    fi
  )
  local file
  for file in $FILES .env; do [ -f "$CANDIDATE/$file" ] || fail failed "missing required file: $file"; done
  if [ -n "$BUNDLE" ]; then
    docker load -i "$CANDIDATE/images.tar" || fail failed "loading bundle images failed; nothing was stopped"
  fi
  if [ "$(database_kind)" = mongodb ]; then
    if mongo_compatible; then :; else
      local compatible_status=$?
      [ "$compatible_status" = 1 ] || fail failed "cannot read Compose JSON; install host node/python3/jq or load the installed API image; nothing was stopped"
      fail refused "MongoDB image changes require a supported migration; nothing was stopped or backed up"
    fi
  fi
  if [ -z "$BUNDLE" ]; then
    candidate pull || fail failed "pulling the images of $TARGET failed; nothing was stopped"
  fi
  # Offline images.tar is covered by the archive and content hashes; docker load has no RepoDigests.
  if [ -z "$BUNDLE" ]; then verify_images || fail failed "image verification failed; nothing was stopped"; fi

  # Snapshot before the first mutation. Until commit, every error/signal goes through cleanup.
  if [ "$(database_kind)" != external ]; then
    backup_space || fail failed "not enough backup space; nothing was stopped"
  fi
  # Older installers kept secrets under the API state mount. Preserve them outside it as well.
  [ ! -e "$STATE/rollback" ] || mv "$STATE/rollback" "$ROLLBACK.legacy.$(date +%s).$$"
  [ ! -e "$ROLLBACK" ] || mv "$ROLLBACK" "$ROLLBACK.previous.$(date +%s).$$"
  mkdir -p "$ROLLBACK"
  for file in $FILES .env IMAGES docs tls; do
    [ ! -e "$file" ] || cp -a "$file" "$ROLLBACK/"
  done
  transaction_phase prepared
  TRANSACTION=1
  record failed "$CURRENT" "$TARGET" "maintenance started; completion not confirmed; ingress closed until verification"
  stop_writes backup || fail failed "writers did not shut down cleanly"
  local out
  if [ "$(database_kind)" = external ]; then
    out="$(GACHIPAD_EXTERNAL_BACKUP_CONFIRMED=1 ./backup.sh ./backups)" || fail failed "external database backup acknowledgement failed"
    BACKUP=external
  else
    out="$(./backup.sh ./backups)" || fail failed "backup failed"
    BACKUP="$(sed -n 's/^backup: \(.*\) ([0-9]* bytes)$/\1/p' <<<"$out")"
    [ -n "$BACKUP" ] || fail failed "backup path was not returned"
    [ -s "$BACKUP" ] || fail failed "backup is empty"
    gzip -t -- "$BACKUP" || fail failed "backup archive is corrupt; installed files unchanged"
  fi
  [ -z "$out" ] || printf '%s\n' "$out"
  transaction_phase backed-up
  install_files "$CANDIDATE"
  transaction_phase installed
  DB_TOUCHED=1
  healthy || fail failed "$TARGET did not get healthy"
  # Commit before exposing the verified app. An ingress start can partly succeed and accept
  # writes before reporting failure; restoring the old backup after that would lose those writes.
  TRANSACTION=0
  rm -f "$MARKER"
  if ! open_ingress; then
    stop_writes backup || say "could not confirm writers stopped; inspect docker compose ps" >&2
    fail failed "app verified but ingress failed; current files and DB retained; inspect logs and run docker compose up -d"
  fi
  record updated "$CURRENT" "$TARGET" "" || say "warning: update complete but status could not be written" >&2
  record_database_backend
  say "gachipad $TARGET is running (backup: ${BACKUP:-none})"
}

main() {
  local mode=update tools=0
  MODE=update TARGET="" YES=0 ALLOW_MAJOR=0 DRY=0 AT=04:00 POLICY=patch BUNDLE="" BACKUP="" TRANSACTION=0 DB_TOUCHED=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --mdns-tools) [ "$mode" = update ] || die '--mdns-tools cannot be combined with another mode'; tools=1; mode=mdns-tools; BUNDLE="${2:?--mdns-tools needs a matching offline bundle}"; shift ;;
      --check) mode=check ;;
      --version) TARGET="${2:?--version needs X.Y.Z}"; TARGET="${TARGET#v}"; shift ;;
      --yes | -y) YES=1 ;;
      --allow-major) ALLOW_MAJOR=1 ;;
      --bundle) BUNDLE="${2:?--bundle needs a file}"; mode=bundle; shift ;;
      --auto) mode=auto; YES=1 ;;
      --enable-auto) mode=enable-auto ;;
      --disable-auto) mode=disable-auto ;;
      --at) AT="${2:?--at needs HH:MM}"; shift ;;
      --policy) POLICY="${2:?--policy needs patch or minor}"; shift ;;
      --dry-run) DRY=1 ;;
      -h | --help) usage; return 0 ;;
      *) die "unknown option $1 (./update.sh --help)" ;;
    esac
    shift
  done
  if [ "$tools" = 1 ] && { [ "$mode" != mdns-tools ] || [ "$DRY" = 1 ] || [ -n "$TARGET" ] || [ "$ALLOW_MAJOR" = 1 ]; }; then
    die '--mdns-tools takes only its bundle; it cannot be combined with --dry-run, --version, --allow-major or another mode'
  fi
  MODE="$mode"
  assert_readable_env
  case "$mode:$DRY" in
    check:* | disable-auto:* | enable-auto:1) ;;
    *) assert_no_database_migration ;;
  esac

  mkdir -p "$STATE" && chmod 755 "$STATE"
  install_lock
  trap cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # Rotate at 1 MiB, keep three old logs.
  if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1048576 ]; then
    for n in 2 1; do [ -f "$LOG.$n" ] && mv "$LOG.$n" "$LOG.$((n + 1))"; done
    mv "$LOG" "$LOG.1"
  fi
  # Create the log before tee opens it in the background, so a run as root hands it back too.
  [ "$DRY" = 1 ] || : >>"$LOG"
  [ "$DRY" = 1 ] || exec > >(trap '' HUP INT TERM PIPE; exec tee -i -p -a "$LOG") 2>&1

  if [ "$mode" = mdns-tools ]; then
    need_docker
    [ ! -e "$MARKER" ] || die 'unfinished transaction; recover it before installing mDNS tools'
    mdns_install_tools "$BUNDLE"
    return
  fi

  CURRENT="$(env_get GACHIPAD_VERSION)"
  REPO="$(setting UPDATE_REPO kim0040/gachipad)"
  CHANNEL="$(setting UPDATE_CHANNEL stable)"
  API="$(setting UPDATE_API_URL https://api.github.com)"
  DOWNLOAD="$(setting UPDATE_DOWNLOAD_URL https://github.com)"
  HEALTH_TIMEOUT="$(setting UPDATE_HEALTH_TIMEOUT 180)"
  [[ "$REPO" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || die "UPDATE_REPO must look like owner/name"

  case "$mode" in
    enable-auto) enable_auto; return ;;
    disable-auto) disable_auto; return ;;
  esac

  if [ "$mode" != check ] && { [ -e "$MARKER" ] || [ -L "$MARKER" ]; }; then
    RECORDED=1
    die "unfinished transaction in $MARKER; keep rollback and backups, recover manually per OPERATIONS 15.7 before removing the marker"
  fi

  need_docker
  WORK="$(mktemp -d)"
  case "$mode" in
    bundle) YES=1; update bundle ;;
    auto)
      [ -f "$AUTO_CONF" ] || die "automatic updates are off (./update.sh --enable-auto)"
      AUTO_POLICY="$(sed -n 's/^POLICY=//p' "$AUTO_CONF")"
      [ "$AUTO_POLICY" = minor ] || AUTO_POLICY="patch"
      update auto
      ;;
    *) update "$mode" ;;
  esac
}

# The script file is replaced while it runs; bash must not read on after this line.
main "$@"; exit $?
