# shellcheck shell=bash
# Shared helpers of the deploy scripts. Sourced, not executed.

die() { echo "$(basename "$0"): $*" >&2; exit 1; }

need_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed"
  docker compose version >/dev/null 2>&1 || die "the docker compose plugin is missing"
}

# env_get NAME [default]: value of NAME in .env (last assignment wins)
env_get() {
  local value
  value="$(sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1 || true)"
  # legacy codesh name (1.0.x); remove in 2.0
  if [ -z "$value" ] && [[ "$1" == GACHIPAD_* ]]; then
    value="$(sed -n "s/^CODESH_${1#GACHIPAD_}=//p" .env 2>/dev/null | tail -n 1 || true)"
  fi
  # Compose single quotes keep passwords containing $, # or spaces literal.
  if [[ "$value" == \'*\' ]]; then
    value="${value:1:${#value}-2}"
    value="${value//\\\'/\'}"
  elif [[ "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "${value:-${2:-}}"
}

# env_set NAME VALUE: replaces or appends NAME in .env
env_set() {
  local name="$1" value="$2" tmp line found=0
  case "$name" in DATABASE_URL | GACHIPAD_DATABASE_URL)
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "$name must be a single line"
    [ -z "$value" ] || value="'${value//\'/\\\'}'"
    ;;
  esac
  tmp="$(mktemp .env.XXXXXX)" || return 1
  if [ -f .env ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ "$line" == "$name="* ]]; then
        if [ "$found" = 0 ]; then printf '%s=%s\n' "$name" "$value" >>"$tmp"; found=1; fi
      else printf '%s\n' "$line" >>"$tmp"; fi
    done <.env
  fi
  [ "$found" = 1 ] || printf '%s=%s\n' "$name" "$value" >>"$tmp"
  chmod 600 "$tmp" && mv "$tmp" .env
}

# Network selection is validated before loading images or changing the installation.
network_domain() {
  local domain="$1" label
  [ "${#domain}" -le 253 ] && [[ "$domain" == *.* ]] || return 1
  case "$domain" in *.local | *.localhost | *.invalid | *.test | *.example) return 1 ;; esac
  [[ "${domain##*.}" =~ [a-z] ]] || return 1
  local -a labels=()
  IFS='.' read -r -a labels <<<"$domain"
  [[ "$domain" != *. ]] || return 1
  for label in "${labels[@]}"; do
    [ "${#label}" -le 63 ] && [[ "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1
  done
}

network_proxy_cidr() {
  local address="${1%/*}" prefix="${1##*/}" part count=0 rest
  [[ "$1" == */* && "$prefix" =~ ^[0-9]{1,3}$ ]] || return 1
  prefix=$((10#$prefix))
  [ "$prefix" -gt 0 ] || return 1
  local -a parts=()
  if [[ "$address" == *:* ]]; then
    [ "$prefix" -ge 32 ] && [ "$prefix" -le 128 ] && [[ "$address" =~ ^[0-9a-fA-F:]+$ ]] || return 1
    [[ "$address" != *:::* ]] || return 1
    rest="${address/::/}"
    [[ "$rest" != *::* ]] || return 1
    IFS=':' read -r -a parts <<<"$address"
    for part in "${parts[@]}"; do
      [ -n "$part" ] || continue
      [ "${#part}" -le 4 ] || return 1
      count=$((count + 1))
    done
    if [[ "$address" == *::* ]]; then [ "$count" -lt 8 ];
    else [[ "$address" != :* && "$address" != *: ]] && [ "$count" -eq 8 ]; fi
  else
    [ "$prefix" -ge 8 ] && [ "$prefix" -le 32 ] || return 1
    IFS='.' read -r -a parts <<<"$address"
    [ "${#parts[@]}" -eq 4 ] && [[ "$address" != *. ]] || return 1
    for part in "${parts[@]}"; do
      [[ "$part" =~ ^(0|[1-9][0-9]{0,2})$ ]] && [ "$part" -le 255 ] || return 1
    done
  fi
}

# NETWORK_SUBNET is the IPv4 compose network. Compare the common prefix before trusting a proxy.
network_proxy_overlaps() {
  local proxy="$1" subnet="$2" a b prefix mask
  [[ "$proxy" != *:* && "$subnet" != *:* ]] || return 1
  prefix="${proxy##*/}"
  [ "$prefix" -le "${subnet##*/}" ] || prefix="${subnet##*/}"
  local -a parts=()
  IFS='.' read -r -a parts <<<"${proxy%/*}"
  a=$((parts[0]*16777216 + parts[1]*65536 + parts[2]*256 + parts[3]))
  IFS='.' read -r -a parts <<<"${subnet%/*}"
  b=$((parts[0]*16777216 + parts[1]*65536 + parts[2]*256 + parts[3]))
  mask=$(( (0xffffffff << (32-prefix)) & 0xffffffff ))
  [ "$((a & mask))" = "$((b & mask))" ]
}

network_gateway() {
  local subnet="$1" prefix address mask
  local -a parts=()
  prefix="${subnet##*/}"
  IFS='.' read -r -a parts <<<"${subnet%/*}"
  address=$((parts[0]*16777216 + parts[1]*65536 + parts[2]*256 + parts[3]))
  mask=$(( (0xffffffff << (32-prefix)) & 0xffffffff ))
  address=$(( (address & mask) + 1 ))
  printf '%s.%s.%s.%s' "$((address>>24))" "$(((address>>16)&255))" "$(((address>>8)&255))" "$((address&255))"
}

network_docker_warning() {
  local info
  info="$(docker info --format '{{json .}}' 2>/dev/null)" || info=''
  case "$info" in
    *rootless* | *[Dd]esktop*)
      echo 'warning: docker info reports rootless Docker or Docker Desktop; published ports may rewrite client addresses even over IPv4.' >&2 ;;
    '') echo 'warning: docker info could not report source-address preservation settings.' >&2 ;;
  esac
  if printf '%s' "$info" | grep -Eiq '"ip6tables"[[:space:]]*:[[:space:]]*false|"userland-?proxy"[[:space:]]*:[[:space:]]*true'; then
    echo 'warning: docker info reports disabled ip6tables or enabled userland-proxy; verify source-address preservation before publishing IPv6.' >&2
  else
    echo 'install: verify ip6tables is enabled and userland-proxy is disabled before publishing IPv6; docker info may not expose these daemon settings.'
  fi
  echo 'warning: public port forwarding may rewrite source addresses (rootless Docker / Docker Desktop); a rewritten private address can satisfy the public ADMIN_ALLOW_CIDR default. Set ADMIN_ALLOW_CIDR to source-preserving administrator addresses and verify the forwarding path.' >&2
}

select_network() {
  local fresh="$1" answer url previous
  previous="$(env_get GACHIPAD_NETWORK internal)"
  if [ -n "$NETWORK_OPTION" ]; then GACHIPAD_NETWORK="$NETWORK_OPTION"
  elif [ "$fresh" = 0 ]; then GACHIPAD_NETWORK="$previous"
  else
    GACHIPAD_NETWORK="${GACHIPAD_NETWORK:-internal}"
    if [ -t 0 ] && [ -z "${GACHIPAD_NETWORK_ENV:-}" ]; then
      echo 'internal: for a private network; HTTP, internal TLS or your own certificate.'
      echo 'public: for the internet; requires your DNS name and HTTPS, with stricter abuse limits.'
      read -r -p 'Network [internal/public] (default internal): ' answer || answer=""
      GACHIPAD_NETWORK="${answer:-internal}"
    fi
  fi
  case "$GACHIPAD_NETWORK" in internal | public) ;; *) die 'GACHIPAD_NETWORK / --network must be internal or public' ;; esac
  if [ "$GACHIPAD_NETWORK" = public ]; then
    NETWORK_SUBNET="${NETWORK_SUBNET:-$(env_get NETWORK_SUBNET 172.29.88.0/24)}"
    NETWORK_GATEWAY="$(network_gateway "$NETWORK_SUBNET")"
    url="${PUBLIC_URL:-$(env_get PUBLIC_URL)}"
    if [ -n "$DOMAIN_OPTION" ]; then NETWORK_DOMAIN="$(printf '%s' "$DOMAIN_OPTION" | tr '[:upper:]' '[:lower:]')"
    else
      case "$url" in https://*) NETWORK_DOMAIN="${url#https://}"; NETWORK_DOMAIN="${NETWORK_DOMAIN%/}" ;;
        *) die 'public mode requires --domain example.org or PUBLIC_URL=https://example.org' ;; esac
      NETWORK_DOMAIN="$(printf '%s' "$NETWORK_DOMAIN" | tr '[:upper:]' '[:lower:]')"
    fi
    network_domain "$NETWORK_DOMAIN" || die 'public mode requires a DNS name you own; IP addresses, .local and single-label names are not allowed'
    if [ "$PROXY_OPTION_SET" = 0 ] && [ "$previous" = public ]; then PROXY_OPTION="$(env_get GACHIPAD_BEHIND_PROXY)"; fi
    [ -z "$PROXY_OPTION" ] || network_proxy_cidr "$PROXY_OPTION" || die '--behind-proxy requires an IPv4 prefix >= 8 or IPv6 prefix >= 32'
    if [ -n "$PROXY_OPTION" ] && network_proxy_overlaps "$PROXY_OPTION" "$NETWORK_SUBNET"; then
      die '--behind-proxy must not overlap NETWORK_SUBNET; use a separate proxy network'
    fi
    [ -n "$ACME_OPTION" ] || ACME_OPTION="$(env_get ACME_EMAIL)"
    [ -z "$ACME_OPTION" ] || [[ "$ACME_OPTION" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || die 'ACME_EMAIL / --acme-email must be a plain email address'
    PUBLIC_URL="https://$NETWORK_DOMAIN"
    SITE_ADDRESS="$NETWORK_DOMAIN"
    [ -z "$PROXY_OPTION" ] || SITE_ADDRESS="http://$NETWORK_DOMAIN"
    TRUST_PROXY="$NETWORK_SUBNET${PROXY_OPTION:+,$PROXY_OPTION}"
    export PUBLIC_URL SITE_ADDRESS NETWORK_SUBNET NETWORK_GATEWAY TRUST_PROXY
  elif [ "$previous" = public ]; then
    PUBLIC_URL="${PUBLIC_URL-$(env_get GACHIPAD_INTERNAL_PUBLIC_URL)}"
    SITE_ADDRESS="${SITE_ADDRESS-$(env_get GACHIPAD_INTERNAL_SITE_ADDRESS :80)}"
    export PUBLIC_URL SITE_ADDRESS
  elif [ -n "$DOMAIN_OPTION$PROXY_OPTION$ACME_OPTION" ]; then
    die '--domain, --behind-proxy and --acme-email require --network public'
  fi
  export GACHIPAD_NETWORK
}

persist_network() {
  local fresh="$1" name value previous stored internal_default
  previous="$(env_get GACHIPAD_NETWORK internal)"
  if [ "$GACHIPAD_NETWORK" = public ]; then
    if [ "$previous" != public ]; then
      for name in SITE_ADDRESS PUBLIC_URL SITE_ALIASES CADDY_TRUSTED_PROXIES TRUST_PROXY ADMIN_ALLOW_CIDR GACHIPAD_BIND_ADDRESS; do
        # The caller has not written network overrides yet.
        value="$(env_get "$name")"
        env_set "GACHIPAD_INTERNAL_$name" "$value"
      done
    fi
    env_set PUBLIC_URL "$PUBLIC_URL"
    env_set SITE_ADDRESS "$SITE_ADDRESS"
    env_set SITE_ALIASES ''
    env_set GACHIPAD_PUBLIC_TLS "$(if [ -n "$PROXY_OPTION" ]; then echo proxy; else echo acme; fi)"
    # Default once for the shipped IPv4 network; later runs retain operator changes, including empty.
    if [ "$previous" != public ]; then
      env_set GACHIPAD_BIND_ADDRESS "${GACHIPAD_BIND_ADDRESS-$(env_get GACHIPAD_BIND_ADDRESS 0.0.0.0:)}"
    elif [ "${GACHIPAD_BIND_ADDRESS+x}" = x ]; then
      env_set GACHIPAD_BIND_ADDRESS "$GACHIPAD_BIND_ADDRESS"
    fi
    echo "install: public port binding: $(env_get GACHIPAD_BIND_ADDRESS) (empty means all host addresses); IPv6 requires a source-preserving dual-stack Docker network."
    network_docker_warning
    env_set GACHIPAD_BEHIND_PROXY "$PROXY_OPTION"
    env_set ACME_EMAIL "$ACME_OPTION"
    env_set CADDY_TRUSTED_PROXIES "${PROXY_OPTION:-127.0.0.1/32}"
    env_set NETWORK_SUBNET "$NETWORK_SUBNET"
    env_set NETWORK_GATEWAY "$NETWORK_GATEWAY"
    env_set TRUST_PROXY "$TRUST_PROXY"
    if [ -z "$(env_get ADMIN_ALLOW_CIDR)" ]; then
      env_set ADMIN_ALLOW_CIDR '127.0.0.0/8,::1/128,10.0.0.0/8,192.168.0.0/16,fc00::/7'
    fi
    echo 'install: public admin access is restricted by ADMIN_ALLOW_CIDR; add your administrator IP/CIDR in .env to widen it.'
    echo 'install: public admin defaults omit 172.16.0.0/12; add your administrator CIDR outside NETWORK_SUBNET to ADMIN_ALLOW_CIDR if needed.'
    if [ "$fresh" = 1 ] || [ "$previous" != public ]; then
      while IFS='=' read -r name value; do
        stored="$(env_get "$name")"
        internal_default="$(sed -n "s/^$name=//p" .env.example | tail -n 1)"
        if [ "$fresh" = 1 ]; then env_set "$name" "${!name:-$value}"
        elif [ -z "$stored" ] || [ "$stored" = "$internal_default" ]; then env_set "$name" "$value"
        else echo "install: keeping operator $name=$stored; recommended public value: $value"
        fi
      done <<'LIMITS'
RATE_LIMIT_API_PER_MIN=300
RATE_LIMIT_CODE_PER_MIN=10
RATE_LIMIT_CODE_GLOBAL_FAILURES_PER_MIN=300
RATE_LIMIT_CREATE_PER_MIN=10
RATE_LIMIT_LOGIN_PER_MIN=5
QUOTA_WINDOW_SECONDS=86400
QUOTA_SHARES_PER_CLIENT=50
QUOTA_SHARES_PER_IP=200
QUOTA_UPLOADS_PER_CLIENT=50
QUOTA_UPLOADS_PER_IP=200
QUOTA_BYTES_PER_CLIENT=104857600
QUOTA_BYTES_PER_IP=536870912
UPLOAD_STORAGE_MAX_BYTES=2147483648
SSE_MAX_PER_CLIENT=5
SSE_MAX_PER_IP=50
PRESENCE_MAX_PER_NET=100
LIMITS
    fi
    if [ "${HTTP_PORT:-$(env_get HTTP_PORT 80)}" != 80 ] || [ "${HTTPS_PORT:-$(env_get HTTPS_PORT 443)}" != 443 ]; then
      echo 'warning: public HTTPS requires internet ports 80/443 to reach Caddy (or your TLS proxy); nonstandard host ports need forwarding.' >&2
    fi
    echo 'install: public mode ignores all tls/*.caddy files; automatic HTTPS or your TLS proxy supplies the certificate.'
  elif [ "$previous" = public ]; then
    env_set PUBLIC_URL "$PUBLIC_URL"
    env_set SITE_ADDRESS "$SITE_ADDRESS"
    for name in SITE_ALIASES CADDY_TRUSTED_PROXIES TRUST_PROXY ADMIN_ALLOW_CIDR GACHIPAD_BIND_ADDRESS; do
      env_set "$name" "$(env_get "GACHIPAD_INTERNAL_$name")"
    done
    TRUST_PROXY="$(env_get TRUST_PROXY)"
    export TRUST_PROXY
    env_set GACHIPAD_BEHIND_PROXY ''
    env_set GACHIPAD_PUBLIC_TLS acme
  fi
  env_set GACHIPAD_NETWORK "$GACHIPAD_NETWORK"
}

network_addresses() {
  echo "install: network $(env_get GACHIPAD_NETWORK internal)"
  if [ "$(env_get GACHIPAD_NETWORK internal)" = public ]; then
    echo "install: open $(env_get PUBLIC_URL)"
    echo "install: point DNS A for $NETWORK_DOMAIN to this server's public IPv4 address (or the TLS proxy)."
    echo 'install: guests can create documents; set guestAllowed=false in the admin console and configure OIDC/LDAP for a closed site.'
    echo 'install: for a large shared NAT, raise SSE_MAX_PER_IP, RATE_LIMIT_API_PER_MIN and RATE_LIMIT_CODE_PER_MIN as needed.'
    if [ -n "$(env_get GACHIPAD_BEHIND_PROXY)" ]; then
      echo 'install: open TCP 443 on the TLS proxy; forward HTTP to Caddy only from the configured proxy CIDR. Send X-Forwarded-For and X-Forwarded-Proto: https.'
      echo 'install: --behind-proxy should name a single host (/32 for IPv4 or /128 for IPv6); broad ranges can turn real clients into unknown and share their limits.'
      if [[ "$PROXY_OPTION" != *:* ]] && [ "${PROXY_OPTION##*/}" -lt 16 ]; then
        echo 'warning: --behind-proxy is broader than /16; use a single-host CIDR to preserve client identities.' >&2
      fi
    else
      echo 'install: open/forward internet TCP 80 and 443 to Caddy for HTTPS redirects and free ACME certificates.'
      echo 'install: the first certificate may take a minute; local API health was checked independently of ACME.'
    fi
  else
    [ -z "$(env_get PUBLIC_URL)" ] || echo "install: open $(env_get PUBLIC_URL)"
    mdns_addresses
  fi
}

# Linux host networking is required; Docker Desktop's Linux VM cannot advertise the host.
mdns_supported() {
  [ "$(uname -s)" = Linux ] || return 1
  [ "$(docker info --format '{{.OSType}}' 2>/dev/null)" = linux ] || return 1
  case "$(docker info --format '{{.OperatingSystem}}' 2>/dev/null)" in Docker\ Desktop*) return 1 ;; esac
  if [ -r /proc/version ] && grep -qi microsoft /proc/version; then return 1; fi
  local endpoint="${DOCKER_HOST:-}"
  if [ -z "$endpoint" ]; then
    endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" || return 1
  fi
  case "$endpoint" in unix://*) return 0 ;; *) return 1 ;; esac
}

mdns_image() {
  printf '%s/gachipad-mdns:%s' "$(env_get GACHIPAD_REGISTRY ghcr.io/kim0040)" "$(env_get GACHIPAD_VERSION "$(cat VERSION 2>/dev/null)")"
}

# mdns_manifest_entry TAG < manifest.json: line 1 is the manifest reduced to the entry tagged TAG
# (RepoTags reduced to TAG), the other lines are its config and layer files. Fails unless exactly one matches.
mdns_manifest_entry() {
  if command -v node >/dev/null 2>&1; then
    node -e '
      const tag = process.argv[1];
      const found = JSON.parse(require("node:fs").readFileSync(0, "utf8")).filter((e) => (e.RepoTags || []).includes(tag));
      if (found.length !== 1) process.exit(1);
      found[0].RepoTags = [tag];
      console.log(JSON.stringify([found[0]]));
      console.log([found[0].Config, ...found[0].Layers].join("\n"));
    ' "$1"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
found = [e for e in json.load(sys.stdin) if sys.argv[1] in (e.get("RepoTags") or [])]
if len(found) != 1: sys.exit(1)
found[0]["RepoTags"] = [sys.argv[1]]
print(json.dumps([found[0]]))
print("\n".join([found[0]["Config"], *found[0]["Layers"]]))
' "$1"
  elif command -v jq >/dev/null 2>&1; then
    jq -er --arg tag "$1" '[.[] | select((.RepoTags // []) | index($tag)) | .RepoTags = [$tag]] |
      select(length == 1) | (tojson, .[0].Config, .[0].Layers[])'
  else return 1; fi
}

# mdns_filter_images ARCHIVE DIR OUT: a docker archive with only the mdns image of ARCHIVE, so loading it
# cannot re-tag the other images of the bundle. DIR is scratch space, OUT must lie outside it.
mdns_filter_images() {
  local archive="$1" dir="$2" out="$3" lines member target
  local -a files=() extra=()
  mkdir -p "$dir" && tar xf "$archive" -C "$dir" manifest.json 2>/dev/null || return 1
  lines="$(mdns_manifest_entry "$(mdns_image)" <"$dir/manifest.json")" || return 1
  printf '%s\n' "${lines%%$'\n'*}" >"$dir/manifest.json"
  while IFS= read -r member; do
    [[ "$member" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@+-]*$ && "/$member/" != */../* ]] || return 1
    files+=("$member")
  done <<<"${lines#*$'\n'}"
  tar xf "$archive" -C "$dir" "${files[@]}" || return 1
  for member in "${files[@]}"; do
    [ -L "$dir/$member" ] || continue
    # A layer shared with another directory of the archive is stored as ../<id>/layer.tar.
    target="$(readlink "$dir/$member")"
    [[ "$target" =~ ^\.\./([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)$ ]] || return 1
    extra+=("${BASH_REMATCH[1]}")
  done
  if [ "${#extra[@]}" -gt 0 ]; then tar xf "$archive" -C "$dir" "${extra[@]}" || return 1; fi
  for member in "${files[@]}"; do [ -e "$dir/$member" ] || return 1; done
  tar cf "$out" -C "$dir" manifest.json "${files[@]}" ${extra[@]+"${extra[@]}"} || return 1
  rm -rf "$dir"
}

# Restore the optional helper after an updater with a fixed legacy file list. Only the mdns image is loaded.
mdns_install_tools() (
  local bundle="$1" stage status=0
  [ -f .env ] || die '.env is missing'
  verify_archive "$bundle"
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"; rm -f ./mdns.sh.new' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  tar --no-same-owner -xzf "$bundle" -C "$stage" || status=$?
  if [ "$status" = 0 ]; then
    local source
    source="$(find "$stage" -maxdepth 2 -name mdns.sh -exec dirname {} \; | head -n 1)"
    if [ -z "$source" ] || ! (verify_bundle "$source") ||
      [ "$(cat "$source/VERSION")" != "$(env_get GACHIPAD_VERSION)" ] || [ ! -f "$source/images.tar" ] ||
      ! grep -Eq '^[0-9a-fA-F]{64} [ *](\./)?mdns\.sh$' "$source/SHA256SUMS" ||
      ! grep -Eq '^[0-9a-fA-F]{64} [ *](\./)?images\.tar$' "$source/SHA256SUMS"; then
      echo 'mdns: need the verified offline bundle matching the installed version' >&2
      status=1
    elif ! mdns_filter_images "$source/images.tar" "$stage/image" "$stage/mdns-image.tar"; then
      echo "mdns: images.tar has no usable $(mdns_image) entry (host node, python3 or jq is needed to read it); nothing was loaded" >&2
      status=1
    elif docker load -i "$stage/mdns-image.tar" && docker image inspect "$(mdns_image)" >/dev/null 2>&1 && cp -p "$source/mdns.sh" ./mdns.sh.new && mv ./mdns.sh.new ./mdns.sh; then
      echo 'mdns: tools installed; run ./mdns.sh enable'
    else status=1; fi
  fi
  rm -rf "$stage"
  return "$status"
)

mdns_require_image() {
  local image
  image="$(mdns_image)"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "mdns: local image $image is missing; trying the registry. For offline use: ./update.sh --mdns-tools /path/to/matching-bundle.tar.gz" >&2
    if ! docker compose --profile mdns pull mdns || ! docker image inspect "$image" >/dev/null 2>&1; then
      echo 'mdns: cannot probe or enable without the local image; load the matching offline bundle with the command above.' >&2
      return 1
    fi
  fi
}

mdns_run() {
  # A Node deadline bounds the query; timeout also bounds Docker startup. Never pull at install time.
  command -v timeout >/dev/null 2>&1 || return 2
  local name="gachipad-mdns-probe-$$" status=0
  timeout -k 1 6 docker run --rm --pull never --name "$name" --network host --read-only \
    --cap-drop ALL --security-opt no-new-privileges -e "MDNS_IP=${MDNS_IP:-$(env_get MDNS_IP)}" \
    "$(mdns_image)" node index.mjs "$@" 2>/dev/null || status=$?
  if [ "$status" = 124 ] || [ "$status" = 137 ]; then
    docker rm -f "$name" >/dev/null 2>&1 || true
  fi
  return "$status"
}

mdns_profile() {
  local enabled="$1" profiles profile result=""
  profiles="$(env_get COMPOSE_PROFILES)"
  local -a entries=()
  IFS=',' read -r -a entries <<<"$profiles"
  for profile in ${entries[@]+"${entries[@]}"}; do
    profile="${profile#"${profile%%[![:space:]]*}"}"
    profile="${profile%"${profile##*[![:space:]]}"}"
    if [ -z "$profile" ] || [ "$profile" = mdns ]; then continue; fi
    [ -z "$result" ] || result+=,
    result+="$profile"
  done
  if [ "$enabled" = 1 ]; then [ -z "$result" ] || result+=,; result+=mdns; fi
  env_set COMPOSE_PROFILES "$result"
  COMPOSE_PROFILES="$result"; export COMPOSE_PROFILES
}

mdns_choose_name() {
  local original="${MDNS_HOSTNAME:-$(env_get MDNS_HOSTNAME gachipad.local)}" candidate status number
  if [[ ! "$original" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.local$ ]] ||
    [ "${#original}" -gt 66 ]; then die "MDNS_HOSTNAME must be a single-label .local host name (at most 60 characters before .local)"; fi
  candidate="$original"
  for number in {1..10}; do
    status=0
    mdns_run --probe "$candidate" >/dev/null || status=$?
    case "$status" in
      0)
        if [ "$candidate" != "$original" ]; then echo "mdns: $original is in use; using $candidate."; fi
        env_set MDNS_HOSTNAME "$candidate"
        MDNS_HOSTNAME="$candidate"; export MDNS_HOSTNAME
        return ;;
      10) candidate="${original%.local}-$((number + 1)).local" ;;
      125 | 126 | 127) echo "mdns: local probe image or command unavailable; keeping $original (name was not checked)." >&2; break ;;
      124 | 137) echo "mdns: name check timed out; keeping $original (check for conflicts on your network)." >&2; break ;;
      *) echo "mdns: name check failed; keeping $original (check for conflicts on your network)." >&2; break ;;
    esac
  done
  if [ "$status" = 10 ]; then echo "mdns: no free name found in 10 attempts; keeping $original (check for conflicts on your network)." >&2; fi
  env_set MDNS_HOSTNAME "$original"
  MDNS_HOSTNAME="$original"; export MDNS_HOSTNAME
}

mdns_check_aliases() {
  local alias status aliases
  aliases="${MDNS_ALIASES:-$(env_get MDNS_ALIASES)}"
  local -a names=()
  IFS=',' read -r -a names <<<"$aliases"
  for alias in ${names[@]+"${names[@]}"}; do
    [ -n "$alias" ] || continue
    status=0; mdns_run --probe "$alias" >/dev/null || status=$?
    case "$status" in
      0) ;;
      10) echo "mdns: alias $alias is in use by another host; remove or change MDNS_ALIASES before relying on it." >&2 ;;
      *) echo "mdns: alias $alias could not be checked; confirm it on your network." >&2 ;;
    esac
  done
}

select_mdns() {
  local choice="$1" answer
  [ "$(env_get GACHIPAD_NETWORK internal)" != public ] || die 'mDNS cannot be enabled in public mode; switch to internal mode first'
  case "$choice" in auto | 0 | 1) ;; *) die "GACHIPAD_MDNS must be 0 or 1" ;; esac
  if ! mdns_supported; then
    echo "mdns: disabled; a native Linux Docker host is required for multicast host networking."
    mdns_profile 0
    return
  fi
  if [ "$choice" = auto ]; then
    choice=1
    if [ -t 0 ]; then
      read -r -p "Enable short name ${MDNS_HOSTNAME:-$(env_get MDNS_HOSTNAME gachipad.local)} on this network? [Y/n]: " answer || answer=""
      case "$answer" in n | N | no | NO) choice=0 ;; esac
    fi
  fi
  if [ "$choice" = 1 ]; then mdns_choose_name; mdns_check_aliases; fi
  mdns_profile "$choice"
}

mdns_enabled() {
  case ",${COMPOSE_PROFILES-$(env_get COMPOSE_PROFILES)}," in *,mdns,*) return 0 ;; *) return 1 ;; esac
}

mdns_host_addresses() {
  if [ "$(uname -s)" = Linux ] && command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null | awk '
      $2 !~ /^(docker|veth|virbr)/ && !(length($2) == 15 && $2 ~ /^br-[0-9a-f]+$/) {split($4, address, "/"); print address[1]}'
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig 2>/dev/null | awk '
      /^[^[:space:]]/ {interface=$1; sub(/:$/, "", interface)}
      $1 == "inet" && $2 != "127.0.0.1" && interface !~ /^(docker|veth|virbr)/ && !(length(interface) == 15 && interface ~ /^br-[0-9a-f]+$/) {print $2}'
  fi
}

mdns_addresses() {
  local port suffix="" address site public direct=0
  port="$(env_get HTTP_PORT 80)"
  [ "$port" = 80 ] || suffix=":$port"
  site="$(env_get SITE_ADDRESS :80)"
  public="$(env_get PUBLIC_URL)"
  case "$site" in :* | http:// | http://:*) direct=1 ;; esac
  case "$public" in https://*) direct=0 ;; esac
  if mdns_enabled; then
    if [ "$direct" = 1 ]; then
      echo "mdns: open http://$(env_get MDNS_HOSTNAME gachipad.local)$suffix"
    else
      echo "mdns: $(env_get MDNS_HOSTNAME gachipad.local) advertised; named sites need a matching SITE_ALIASES entry (and a certificate for HTTPS; see tls/README.md)."
    fi
    if [ "$direct" = 1 ]; then
      echo 'mdns: some networks and Android devices do not resolve .local; use a server IP address then.'
    else
      echo 'mdns: some networks and Android devices do not resolve .local; use the configured site name or an IP covered by its HTTP/TLS configuration.'
    fi
  fi
  if ! mdns_supported; then
    echo 'install: automatic server IP discovery requires a local native Linux Docker host.'
    return
  fi
  while IFS= read -r address; do
    [[ "$address" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
    if [ "$direct" = 1 ]; then echo "install: server address http://$address$suffix"
    else echo "install: server IP $address (use the configured site name and its HTTP/TLS settings)"; fi
  done < <(mdns_host_addresses || true)
}

# database_kind reads the effective deployment choice without ever printing a database URL.
database_kind() {
  local url kind
  url="${DATABASE_URL:-$(env_get DATABASE_URL)}"
  if [ -n "$url" ]; then
    validate_database_url "$url" || die "DATABASE_URL has an unsupported scheme"
    if [[ "$url" == sqlite:* ]]; then printf sqlite; else printf external; fi
    return
  fi
  kind="${GACHIPAD_DB:-$(env_get GACHIPAD_DB)}"
  if [ -z "$kind" ]; then
    if grep -Eq '^MONGO_[A-Z0-9_]+=' .env 2>/dev/null; then kind=mongodb; else kind=sqlite; fi
  fi
  case "$kind" in sqlite | postgres | mongodb | external) printf '%s' "$kind" ;;
    *) die "GACHIPAD_DB must be sqlite, postgres, mongodb or external" ;;
  esac
}

validate_database_url() {
  [[ "$1" != *$'\n'* && "$1" != *$'\r'* && "$1" == *:* ]] || return 1
  local scheme="${1%%:*}"
  case "$scheme" in
    sqlite | postgres | postgresql | mysql | mariadb | mongodb | mongodb+srv) return 0 ;;
    *) return 1 ;;
  esac
}

database_project() {
  local fallback=gachipad
  [ -z "$(env_get CODESH_VERSION)" ] || fallback=codesh
  printf '%s' "${COMPOSE_PROJECT_NAME:-$(env_get COMPOSE_PROJECT_NAME "${GACHIPAD_PROJECT:-$(env_get GACHIPAD_PROJECT "$fallback")}")}"
}

database_volume_suffix() {
  case "$1" in sqlite) printf gachipad-data ;; postgres) printf postgres-data ;;
    mongodb) printf mongo-data ;; esac
}

database_volume_nonempty() {
  local volume="$1" kind="${2:-}" result url image registry version
  docker volume inspect "$volume" >/dev/null 2>&1 || return 1
  url="$(env_get GACHIPAD_DATABASE_URL)"
  [[ "$url" == sqlite:* ]] || url=""
  registry="$(sed -n 's/^GACHIPAD_REGISTRY=//p' .env.example 2>/dev/null | tail -n 1)"
  registry="${registry:-$(env_get GACHIPAD_REGISTRY ghcr.io/kim0040)}"
  version="$(cat VERSION 2>/dev/null || env_get GACHIPAD_VERSION)"
  image="$registry/gachipad-api:$version"
  result="$(GACHIPAD_PROBE_SQLITE_URL="$url" docker run --rm --pull never --network none --read-only --security-opt no-new-privileges --cap-drop ALL --user 0 --cap-add DAC_OVERRIDE -v "$volume:/probe:ro" -e GACHIPAD_PROBE_SQLITE_URL \
    --entrypoint node "$image" -e '
      const { readdirSync, existsSync } = require("node:fs");
      const url = process.env.GACHIPAD_PROBE_SQLITE_URL ?? "";
      const path = url.startsWith("sqlite:") ? (url.startsWith("sqlite://")
        ? decodeURIComponent(new URL(url).pathname) : url.slice(7)) : "/data/gachipad.db";
      const relative = path.startsWith("/data/") ? path.slice(6) : "gachipad.db";
      const nonempty = process.argv[1] === "sqlite"
        ? existsSync("/probe/gachipad.db") || existsSync(`/probe/${relative}`)
        : readdirSync("/probe").length > 0;
      process.stdout.write(nonempty ? "nonempty" : "empty");
    ' "$kind" 2>/dev/null)" || die "cannot inspect existing database volume $volume; refusing to change the database backend"
  [ "$result" = nonempty ]
}

assert_no_database_migration() {
  local first
  if [ -e state/transaction ] || [ -L state/transaction ]; then
    if [ -f state/transaction ] && [ -r state/transaction ]; then
      first="$(head -n1 state/transaction 2>/dev/null)" || first=""
      [[ "$first" != FROM=* ]] || return 0
    fi
    echo "$(basename "$0"): unfinished or running database migration or unreadable transaction in state/transaction; follow the recovery recipe below" >&2
    if [ -f state/transaction ] && [ -r state/transaction ] && grep -qx 'database migration' state/transaction 2>/dev/null; then
      migration_recovery_hint "" >&2
    else
      echo 'migrate-db: unfinished transaction; preserve all data and snapshots, inspect state/transaction and recover manually per OPERATIONS 9.6 or 15.7 before clearing it.' >&2
    fi
    exit 1
  fi
  if [ -e state/transaction.tmp ] || [ -L state/transaction.tmp ] ||
    compgen -G '.env.migrate-db.*' >/dev/null; then
    die 'unfinished database migration staging files or state/transaction.tmp; preserve them and recover manually per OPERATIONS 9.6, or for an interrupted update per OPERATIONS 15.7, before continuing'
  fi
}

# A migration snapshot is different from update.sh's rollback directory. Never delete the
# transaction until the selected backend is healthy; a hard crash can interrupt the env/marker pair.
migration_recovery_hint() {
  local stage="${1:-$(sed -n 's/^snapshot=//p' state/transaction 2>/dev/null)}"
  local phase source target volume run owner project boot boot_time lock_time
  owner="$(cat state/install.lock.d/owner 2>/dev/null || true)"
  boot="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || true)"
  boot_time="$(awk '$1 == "btime" {print $2}' /proc/stat 2>/dev/null || true)"
  lock_time="$(stat -c %Y state/install.lock.d 2>/dev/null || true)"
  if [[ "$owner" =~ ^[0-9]+$ ]] && [ "$owner" != "$$" ] && kill -0 "$owner" 2>/dev/null &&
    [ -n "$boot" ] && [ "$(cat state/install.lock.d/boot 2>/dev/null)" = "$boot" ] &&
    [[ "$boot_time" =~ ^[0-9]+$ && "$lock_time" =~ ^[0-9]+$ ]] && [ "$lock_time" -ge "$boot_time" ] &&
    tr '\0' '\n' 2>/dev/null <"/proc/$owner/cmdline" | grep -Eq '(^|/)migrate-db\.sh$'; then
    printf 'migrate-db: migration in progress (pid %s); wait.\n' "$owner"
    return
  fi
  # migration_cleanup passes its own stage: that marker was left on purpose, not stale.
  [ -n "${1:-}" ] || echo 'migrate-db: if no migrate-db.sh process is running, this marker may be stale; follow the recovery recipe below.'
  phase="$(sed -n 's/^phase=//p' state/transaction 2>/dev/null)"
  source="$(sed -n 's/^source=//p' state/transaction 2>/dev/null)"
  target="$(sed -n 's/^destination=//p' state/transaction 2>/dev/null)"
  volume="$(sed -n 's/^volume=//p' state/transaction 2>/dev/null)"
  run="$(sed -n 's/^run=//p' state/transaction 2>/dev/null)"
  echo 'migrate-db: first verify the migration process has exited; clear shell overrides: unset DATABASE_URL GACHIPAD_DB COMPOSE_PROFILES GACHIPAD_DATABASE_URL'
  if [ "$phase" = live ]; then
    echo 'migrate-db: if the cmp check below exits 0, keep the destination and roll forward first: docker compose ps; check /healthz and shares/uploads, then clear the marker once healthy. If it exits 1, do not clear the marker yet.'
    echo 'migrate-db: rollback requires reconciling writes accepted since the switch first; preserve both databases and the snapshot until reconciled.'
  else
    if [[ "$run" =~ ^[a-f0-9]{32}$ ]]; then
      printf 'migrate-db: remove any surviving one-off containers before restarting writers: docker rm -f'
      printf ' gachipad-migrate-%s-%s' "$run" image "$run" preflight "$run" checkpoint "$run" users "$run" copy
      printf '\n'
    fi
    case "$phase" in
      preflight) echo 'migrate-db: preflight did not stop writers or change the live configuration; no writer stop, configuration restore or backend restart is needed.' ;;
      *) echo 'migrate-db: keep writers stopped: docker compose stop caddy api collab' ;;
    esac
  fi
  if [[ "$stage" =~ ^\.env\.migrate-db\.[A-Za-z0-9]+$ ]] && [ -f "$stage/original.env" ]; then
    if [ "$phase" = live ]; then
      printf 'migrate-db: identify the active backend configuration: cmp -s .env %q/.env (exit 0: new backend is active; roll forward; exit 1: old backend was restored; treat as rollback and reconcile destination writes, or .env was edited by hand; other exits: inspect manually).\n' "$stage"
      printf 'migrate-db: on exit 1, restart the restored backend: docker compose up -d --pull never --wait; or roll forward instead: cp -p %q/.env .env and write the destination kind to state/database-kind.\n' "$stage"
    fi
    if [ "$phase" != preflight ] && [ "$phase" != live ]; then
      case "$target" in
        postgres) printf 'migrate-db: stop and remove the destination containers: docker compose --env-file %q/.env rm -sf postgres\n' "$stage" ;;
        mongodb) printf 'migrate-db: stop and remove the destination containers and anonymous volumes: docker compose --env-file %q/.env rm -sfv mongo-users mongo\n' "$stage" ;;
      esac
      project="$(database_project)"
      printf 'migrate-db: inspect and stop surviving backup one-offs before restarting writers: docker ps -a --filter label=com.docker.compose.oneoff=True --filter %q\n' "label=com.docker.compose.project=$project"
      case "$phase" in
        backup | copy) echo 'migrate-db: live configuration and backend marker are unchanged; keep the saved source configuration.' ;;
        *)
          printf 'migrate-db: restore configuration: cp -p %q/original.env .env\n' "$stage"
          if [ -f "$stage/original.kind" ]; then
            printf 'migrate-db: restore marker: cp -p %q/original.kind state/database-kind\n' "$stage"
          else echo 'migrate-db: if there was no marker before: rm -f state/database-kind'; fi
          ;;
      esac
      echo 'migrate-db: restart the saved backend and check shares/uploads: docker compose up -d --pull never --wait'
    fi
    case "$phase" in
      preflight) echo 'migrate-db: destination was only probed; preserve existing destination data.' ;;
      backup) case "$target" in postgres | mongodb) echo 'migrate-db: destination startup may have initialized an empty volume; inspect it before retrying.' ;; esac ;;
      copy) echo 'migrate-db: destination may hold a partial copy; inspect and clear only destination data before retrying.' ;;
      *) echo 'migrate-db: destination may have accepted writes; retain and reconcile those writes before retrying or removing data.' ;;
    esac
    if [[ "$volume" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
      if [ "$target" = sqlite ]; then
        printf 'migrate-db: SQLite destination uses shared data volume %s; preserve the volume, uploads and all other files.\n' "$volume"
      else
        printf 'migrate-db: destination volume to inspect (never remove the source volume): %s\n' "$volume"
        if [ "$phase" != live ] && [[ "$run" =~ ^[a-f0-9]{32}$ ]]; then
          case "$target" in postgres | mongodb)
            printf 'migrate-db: remove a destination volume only if it is empty and this command lists that exact name: docker volume ls -q --filter label=gachipad.migration=%s\n' "$run"
            # shellcheck disable=SC2016 # print the operator's command, do not execute it
            printf 'migrate-db: with destination containers stopped, prove it is empty using a read-only inspection: docker volume inspect %s >/dev/null && docker run --rm --pull never --network none --read-only --security-opt no-new-privileges --cap-drop ALL --user 0 --cap-add DAC_OVERRIDE --mount type=volume,src=%s,dst=/probe,volume-nocopy,readonly --entrypoint node "$(docker compose images -q api | head -n1)" -e %q; only exit 0 proves emptiness.\n' "$volume" "$volume" 'process.exit(require("node:fs").readdirSync("/probe").length === 0 ? 0 : 1)'
            ;;
          esac
        fi
      fi
    fi
    case "$target" in
      sqlite) echo 'migrate-db: SQLite destination files only: /data/gachipad.db, /data/gachipad.db-wal and /data/gachipad.db-shm; inspect with writers stopped; preserve the shared volume and uploads.' ;;
      external)
        printf 'migrate-db: inspect the external destination selected in %q/.env with its server tools; keep credentials private.\n' "$stage"
        case "$phase" in switch | live) echo 'migrate-db: do not remove the snapshot until writes since the switch are reconciled.' ;; esac
        ;;
    esac
    if [ "$phase" != preflight ]; then
      echo 'migrate-db: after backup processes exit, inspect/remove only interrupted backups/.backup.* files; preserve completed archives.'
      if [ "$source" = sqlite ]; then
        echo 'migrate-db: inspect interrupted .gachipad-backup-* directories beside the source SQLite file; preserve the source database and its -wal/-shm files.'
      fi
    fi
    printf 'migrate-db: only after recovery succeeds and any destination writes are reconciled, remove the snapshot and temporary files, then the transaction marker: rm -rf -- %q && rm -f .env.migrate-next .env.migrate-recovery state/database-kind.tmp state/transaction.tmp state/transaction\n' "$stage"
  elif [ "$phase" = preflight ]; then
    echo 'migrate-db: snapshot unavailable; preflight left the live configuration untouched. Preserve shared data volumes and inspect retained staging files before clearing state/transaction.'
  elif [ "$phase" != live ]; then
    echo 'migrate-db: locate the private .env.migrate-db.*/original.env snapshot; restore it and its original.kind (or remove the marker if originally absent), restart the saved backend and check shares/uploads before removing the snapshot and state/transaction.'
  fi
  echo 'migrate-db: verify stale lock ownership before removing state/install.lock.d.'
}

database_migration_hint() {
  if [ -f migrate-db.sh ]; then
    printf 'use ./migrate-db.sh to copy data and switch backends.'
  else
    printf 'extract migrate-db.sh from the verified deployment bundle into this installation before migrating.'
  fi
}

# Refuse a backend switch before Compose can start a new database beside old data.
assert_database_backend() {
  local selected marker project kind volume
  selected="$(database_kind)"
  marker="$(cat state/database-kind 2>/dev/null || true)"
  if [ -n "$marker" ] && [ "$marker" != "$selected" ]; then
    die "database backend change refused ($marker -> $selected); $(database_migration_hint)"
  fi
  # A successful migration deliberately retains the previous backend volumes.
  [ "$marker" != "$selected" ] || return 0
  project="$(database_project)"
  for kind in sqlite postgres mongodb; do
    [ "$kind" = "$selected" ] && continue
    volume="${project}_$(database_volume_suffix "$kind")"
    if database_volume_nonempty "$volume" "$kind"; then
      die "database backend change refused: non-empty $kind volume $volume exists while $selected is selected. $(database_migration_hint)"
    fi
  done
}

record_database_backend() {
  mkdir -p state
  printf '%s\n' "$(database_kind)" >state/database-kind.tmp
  chmod 600 state/database-kind.tmp
  mv state/database-kind.tmp state/database-kind
}

# One installation-wide lock, inherited only by children of its holder. The mkdir fallback
# deliberately leaves a stale lock after SIGKILL: an operator must verify the PID before removal.
# A run as root before 1.2.1 (sudo, or the automatic-update timer) could leave .env root-only.
assert_readable_env() {
  if [ -e .env ] && [ ! -r .env ]; then
    die "cannot read .env as $(id -un): an earlier run as root left the files of this installation owned by root. Run a command once with sudo, for example sudo ./update.sh --check: from 1.2.1 on it gives the files back when it finishes."
  fi
}

install_lock() {
  local path owner boot boot_time lock_time
  assert_readable_env
  path="$(pwd -P)/state/install.lock"
  mkdir -p state
  INSTALL_LOCK_OWNED=0
  if [ "${GACHIPAD_LOCK_PATH:-}" = "$path" ] && [ -n "${GACHIPAD_LOCK_PID:-}" ] &&
    kill -0 "$GACHIPAD_LOCK_PID" 2>/dev/null &&
    [ "$(cat "$path.d/owner" 2>/dev/null)" = "$GACHIPAD_LOCK_PID" ]; then
    if [ "${GACHIPAD_LOCK_KIND:-}" = mkdir ]; then return; fi
    if [ "${GACHIPAD_LOCK_KIND:-}" = flock ] && [ -e /proc/self/fd/9 ] &&
      [ /proc/self/fd/9 -ef "$path" ]; then return; fi
  fi
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$path"
    flock -n 9 || die "another update, upgrade, backup, restore or migration is running"
    GACHIPAD_LOCK_KIND=flock
  else
    GACHIPAD_LOCK_KIND="mkdir"
  fi
  # Also arbitrate through mkdir when flock exists, so callers with different PATHs cannot
  # bypass one another by selecting different primitives.
  if ! mkdir "$path.d" 2>/dev/null; then
    owner="$(cat "$path.d/owner" 2>/dev/null || true)"
    boot="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || true)"
    boot_time="$(awk '$1 == "btime" {print $2}' /proc/stat 2>/dev/null || true)"
    lock_time="$(stat -c %Y "$path.d" 2>/dev/null || true)"
    if [ "$GACHIPAD_LOCK_KIND" = flock ] && {
      { [[ "$owner" =~ ^[0-9]+$ ]] && ! kill -0 "$owner" 2>/dev/null; } ||
      { [ -n "$boot" ] && [ -f "$path.d/boot" ] && [ "$(cat "$path.d/boot")" != "$boot" ]; } ||
      { [[ "$boot_time" =~ ^[0-9]+$ && "$lock_time" =~ ^[0-9]+$ ]] && [ "$lock_time" -lt "$boot_time" ]; };
    }; then
      rm -f "$path.d/owner" "$path.d/boot"
      rmdir "$path.d" || die "cannot reclaim stale installation lock"
      mkdir "$path.d" || die "cannot reclaim stale installation lock"
    else
      die "installation is locked ($path.d); verify its owner before removing a stale lock"
    fi
  fi
  printf '%s\n' "$$" >"$path.d/owner"
  cat /proc/sys/kernel/random/boot_id >"$path.d/boot" 2>/dev/null || true
  INSTALL_LOCK_OWNED=1
  export GACHIPAD_LOCK_PATH="$path" GACHIPAD_LOCK_PID="$$" GACHIPAD_LOCK_KIND
}

# give_back_files dir: a run as root (sudo, or the automatic-update timer) leaves what it wrote
# owned by root, and the operator's next ./backup.sh or ./update.sh could not read .env or write
# backups/; before 1.2.1 it also kept the release builder's user ID on extracted scripts, which a
# local user with that ID could then edit. Hand every file and folder in the installation that the
# owner of the installation folder does not own back to that owner, except:
#   - anything on another device (a mounted backup disk may hold other files);
#   - tls folders (and their rollback copies): Caddy reads those keys as root without
#     CAP_DAC_OVERRIDE, so a root-only key must stay root-owned;
#   - links and multiply linked files, so no file outside the installation is handed over.
# That owner can already edit update.sh, which the timer runs as root, so this grants no new
# privilege. Linux hosts (GNU find); elsewhere it does nothing.
give_back_files() {
  [ "$(id -u)" = 0 ] || return 0
  local owner device entry
  owner="$(stat -c '%u:%g' "$1" 2>/dev/null)" || return 0
  [[ "$owner" =~ ^[0-9]+:[0-9]+$ ]] && [ "${owner%%:*}" != 0 ] || return 0
  device="$(stat -c '%d' "$1" 2>/dev/null)" || return 0
  while IFS= read -r -d '' entry; do
    [ "${entry%% *}" = "$device" ] || continue
    chown -h "$owner" -- "${entry#* }" 2>/dev/null || true
  done < <(find "$1" -xdev -mindepth 1 \( -type d -name tls -prune \) -o \
    \( ! -uid "${owner%%:*}" \( -type d -o -type f -links 1 \) -printf '%D %p\0' \) 2>/dev/null)
}

install_unlock() {
  if [ "${INSTALL_LOCK_OWNED:-0}" = 1 ]; then
    give_back_files "${GACHIPAD_LOCK_PATH%/state/install.lock}"
    rm -f "$GACHIPAD_LOCK_PATH.d/owner" "$GACHIPAD_LOCK_PATH.d/boot"
    rmdir "$GACHIPAD_LOCK_PATH.d"
  fi
}

# wait_healthy [seconds] [path]: local Caddy, with the configured site's Host and TLS SNI.
# curl is required: wget variants differ in redirect, TLS routing and total-deadline semantics.
wait_healthy() {
  if [ "$(env_get GACHIPAD_NETWORK internal)" = public ]; then
    local public_deadline public_remaining public_code public_host public_port public_id public_state stable_state=""
    public_deadline=$((SECONDS + ${1:-120}))
    wait_api "${1:-120}" || return 1
    command -v curl >/dev/null 2>&1 || die 'curl is required for bounded health checks'
    public_host="$(env_get PUBLIC_URL)"; public_host="${public_host#https://}"
    public_port="$(env_get HTTP_PORT 80)"
    while [ "$SECONDS" -lt "$public_deadline" ]; do
      public_remaining=$((public_deadline - SECONDS))
      public_code="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' \
        --resolve "$public_host:$public_port:127.0.0.1" --connect-timeout "$public_remaining" --max-time "$public_remaining" \
        "http://$public_host:$public_port/healthz" 2>/dev/null)" || public_code=000
      if [ "$SECONDS" -lt "$public_deadline" ]; then
        case "$(env_get GACHIPAD_PUBLIC_TLS acme):$public_code" in acme:3[0-9][0-9] | proxy:403)
          public_id="$(docker compose ps -q caddy)"
          public_state="$(docker inspect --format '{{.State.Running}} {{.State.Restarting}} {{.RestartCount}}' "$public_id" 2>/dev/null)" || public_state=""
          if [[ "$public_state" == 'true false '* ]]; then
            [ "$stable_state" != "$public_state" ] || return 0
            stable_state="$public_state"
          else stable_state=""; fi
          ;; esac
      fi
      [ "$SECONDS" -ge "$public_deadline" ] || sleep 1
    done
    echo 'public Caddy did not answer locally before the deadline; refusing installation' >&2
    return 1
  fi
  local port url deadline remaining code site host scheme=http
  command -v curl >/dev/null 2>&1 || die "curl is required for bounded health checks"
  site="$(env_get SITE_ADDRESS :80)"
  case "$site" in
    :*|http://*) port="$(env_get HTTP_PORT 80)" ;;
    *) scheme=https; port="$(env_get HTTPS_PORT 443)" ;;
  esac
  host="${site%%,*}"; host="${host#*://}"; host="${host%%/*}"; host="${host%%:*}"
  host="${host:-127.0.0.1}"
  url="$scheme://$host:$port${2:-/healthz}"
  deadline=$((SECONDS + ${1:-120}))
  while [ "$SECONDS" -lt "$deadline" ]; do
    remaining=$((deadline - SECONDS))
    code="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' \
      --resolve "$host:$port:127.0.0.1" --connect-timeout "$remaining" --max-time "$remaining" \
      "$url" 2>/dev/null)" || code=000
    if [[ "$code" =~ ^2[0-9][0-9]$ ]] && [ "$SECONDS" -lt "$deadline" ]; then return 0; fi
    [ "$SECONDS" -lt "$deadline" ] && sleep 1
  done
  echo "no healthy answer from $url within ${1:-120}s; recent logs:" >&2
  docker compose logs --tail 20 >&2 || true
  return 1
}

# Check the API before opening ingress. Node is already in the installed API image.
wait_api() {
  local deadline remaining path
  deadline=$((SECONDS + ${1:-120}))
  for path in /healthz /readyz; do
    while :; do
      remaining=$((deadline - SECONDS))
      [ "$remaining" -gt 0 ] || return 1
      if docker compose exec -T api node -e '
        fetch("http://127.0.0.1:3001" + process.argv[1], {
          redirect: "manual", signal: AbortSignal.timeout(Number(process.argv[2]) * 1000)
        }).then(r => process.exit(r.status >= 200 && r.status < 300 ? 0 : 1))
          .catch(() => process.exit(1));
      ' "$path" "$remaining" && [ "$SECONDS" -lt "$deadline" ]; then break; fi
      [ "$SECONDS" -lt "$deadline" ] && sleep 1
    done
  done
}

# Stop ingress first; compose stop waits for collab's SIGTERM flush and process exit.
# A killed/failed collab must never be mistaken for a consistent backup boundary.
stop_writes() {
  local id service
  docker compose stop caddy || return 1
  docker compose stop --timeout 40 api collab || return 1
  # A manual restore deliberately replaces this DB, including after a crashed/OOM writer.
  [ "${1:-}" != restore ] || return 0
  for service in api collab; do
    for id in $(docker compose ps -a -q "$service"); do
      [ "$(docker inspect --format '{{.State.ExitCode}} {{.State.OOMKilled}}' "$id")" = '0 false' ] || {
        echo "$service did not shut down cleanly; refusing to back up" >&2; return 1;
      }
    done
  done
}

# mongo_transfer dump|validate|restore: Mongo tools as the root user, archive on stdin/stdout.
# inside the mongo container. The password goes through a private config file, never arguments.
mongo_transfer() {
  # Names come from this installation's .env, not from the container: a container created before
  # a partly finished update still carries the old environment (or none of these variables).
  local db user
  db="$(env_get MONGO_DATABASE)" user="$(env_get MONGO_ROOT_USER)"
  # legacy codesh name (1.0.x); remove in 2.0
  if [ -z "$db" ] || [ -z "$user" ]; then
    if [ -n "$(env_get CODESH_VERSION)" ] || [ "$(env_get GACHIPAD_LEGACY_INSTALL)" = 1 ]; then
      db="${db:-codesh}" user="${user:-codesh}"
    else db="${db:-gachipad}" user="${user:-gachipad}"; fi
  fi
  # shellcheck disable=SC2016 # expanded by the shell in the container
  docker compose exec -T -e MONGO_DATABASE="$db" -e MONGO_INITDB_ROOT_USERNAME="$user" mongo sh -c '
    set -eu
    umask 077
    cfg="$(mktemp)"
    trap "rm -f $cfg" EXIT
    mongosh --nodb --quiet --eval "print(\"password: \" + JSON.stringify(process.env.MONGO_INITDB_ROOT_PASSWORD))" </dev/null >"$cfg"
    set -- --quiet --host localhost --username "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --config "$cfg" --archive --gzip
    # legacy codesh name (1.0.x); remove in 2.0
    # Restore either product namespace into this installation only, including on a fresh host.
    if [ "$0" != dump ]; then
      set -- "$@" --nsInclude "${MONGO_DATABASE:-gachipad}.*" --nsInclude "gachipad.*" --nsInclude "codesh.*" \
        --nsFrom "\$database\$.\$collection\$" --nsTo "${MONGO_DATABASE:-gachipad}.\$collection\$"
    fi
    case "$0" in
      dump) mongodump "$@" --db "${MONGO_DATABASE:-gachipad}" ;;
      validate) mongorestore "$@" --dryRun ;;
      restore)
        # --drop alone only drops collections in the archive, leaving failed migrations behind.
        mongosh --quiet --host localhost --eval "if (!db.getSiblingDB(\"admin\").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD)) throw new Error(\"auth failed\"); db.getSiblingDB(process.env.MONGO_DATABASE || \"gachipad\").dropDatabase()" >/dev/null
        mongorestore "$@" --drop ;;
      *) exit 2 ;;
    esac
  ' "$1"
}

# Validate twice before the destructive operation, and retain the current DB even if restore
# subsequently fails (OOM, server mismatch, disk pressure). Call only with all writers stopped.
mongo_restore() {
  gzip -t -- "$1" || { echo "invalid gzip archive; database unchanged" >&2; return 1; }
  mongo_transfer validate <"$1" || { echo "mongorestore dry run failed; database unchanged" >&2; return 1; }
  # Use this engine's validated dump even after rollback restored an older backup.sh.
  mongo_backup ./backups >&2 || return 1
  mongo_transfer restore <"$1"
}

mongo_backup() (
  set -euo pipefail
  umask 077
  local dir="$1" part file
  mkdir -p "$dir" || return 1
  part="$(mktemp "$dir/.backup.XXXXXX")" || return 1
  file="$dir/gachipad-$(date +%Y%m%d-%H%M%S)-${part##*.}.archive.gz"
  trap 'rm -f "$part"' EXIT
  mongo_transfer dump >"$part" || return 1
  [ -s "$part" ] || { echo "mongodump produced no data" >&2; return 1; }
  gzip -t -- "$part" || { echo "mongodump archive is corrupt; backup not published" >&2; return 1; }
  chmod 600 "$part" && mv "$part" "$file" || return 1
  echo "backup: $file ($(wc -c <"$file" | tr -d ' ') bytes)"
)

database_start() {
  local timeout="${1:-120}"
  case "$(database_kind)" in
    mongodb)
      docker compose up -d --pull never --wait --wait-timeout "$timeout" mongo valkey &&
        docker compose run --rm --no-deps --pull never -T mongo-users
      ;;
    postgres) docker compose up -d --pull never --wait --wait-timeout "$timeout" postgres valkey ;;
    sqlite | external) docker compose up -d --pull never --wait --wait-timeout "$timeout" valkey ;;
  esac
}

sqlite_backup() (
  set -euo pipefail
  umask 077
  local dir="$1" part file
  mkdir -p "$dir" || return 1
  part="$(mktemp "$dir/.backup.XXXXXX")" || return 1
  file="$dir/gachipad-$(date +%Y%m%d-%H%M%S)-${part##*.}.archive.gz"
  trap 'rm -f "$part"' EXIT
  docker compose run --rm --no-deps -T --entrypoint node api --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    import { createReadStream, mkdtempSync, rmSync, readdirSync, statSync, statfsSync } from "node:fs";
    import { basename, dirname, join } from "node:path";
    import { pipeline } from "node:stream/promises";
    const url = process.env.DATABASE_URL ?? "sqlite:///data/gachipad.db";
    const source = url.startsWith("sqlite:") && !url.startsWith("sqlite://")
      ? url.slice("sqlite:".length) : decodeURIComponent(new URL(url).pathname);
    const dataDirectory = dirname(source);
    for (const name of readdirSync(dataDirectory)) {
      if (name.startsWith(".gachipad-backup-") || name.startsWith(".gachipad-validate-") || name === `${basename(source)}.restore`)
        rmSync(join(dataDirectory, name), { recursive: true, force: true });
    }
    const bytes = BigInt(statSync(source).size);
    const space = statfsSync(dataDirectory, { bigint: true });
    const required = bytes + (bytes / 5n > 67108864n ? bytes / 5n : 67108864n);
    if (space.bavail * space.bsize < required)
      throw new Error("SQLite data filesystem has insufficient free space for a snapshot or restore (database size plus 20%, at least 64 MiB extra required)");
    const directory = mkdtempSync(join(dataDirectory, ".gachipad-backup-"));
    const path = join(directory, "snapshot.db");
    const cleanup = () => rmSync(directory, { recursive: true, force: true });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.once(signal, () => { cleanup(); process.exit(1); });
    try {
      const db = new DatabaseSync(source);
      try { db.exec("PRAGMA busy_timeout=5000"); db.prepare("VACUUM INTO ?").run(path); }
      finally { db.close(); }
      await pipeline(createReadStream(path), process.stdout);
    } finally { cleanup(); }
  ' | gzip -c >"$part" || return 1
  [ -s "$part" ] || { echo "SQLite backup is empty; backup not published" >&2; return 1; }
  gzip -t -- "$part" || { echo "SQLite backup is corrupt; backup not published" >&2; return 1; }
  chmod 600 "$part" && mv "$part" "$file" || return 1
  echo "backup: $file ($(wc -c <"$file" | tr -d ' ') bytes)"
)

postgres_backup() (
  set -euo pipefail
  umask 077
  local dir="$1" part file
  mkdir -p "$dir" || return 1
  part="$(mktemp "$dir/.backup.XXXXXX")" || return 1
  file="$dir/gachipad-$(date +%Y%m%d-%H%M%S)-${part##*.}.archive.gz"
  trap 'rm -f "$part"' EXIT
  docker compose exec -T postgres sh -c \
    'pg_dump --format=custom --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' |
    gzip -c >"$part" || return 1
  [ -s "$part" ] || { echo "PostgreSQL backup is empty; backup not published" >&2; return 1; }
  gzip -t -- "$part" || { echo "PostgreSQL backup is corrupt; backup not published" >&2; return 1; }
  chmod 600 "$part" && mv "$part" "$file" || return 1
  echo "backup: $file ($(wc -c <"$file" | tr -d ' ') bytes)"
)

sqlite_validate() {
  local bytes
  bytes="$(gzip -dc -- "$1" | wc -c)" || return 1
  gzip -dc -- "$1" | docker compose run --rm --no-deps -T -e GACHIPAD_SQLITE_BYTES="$bytes" --entrypoint node api --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    import { createWriteStream, mkdtempSync, openSync, readSync, closeSync, rmSync, readdirSync, statfsSync } from "node:fs";
    import { pipeline } from "node:stream/promises";
    import { basename, dirname, join } from "node:path";
    const url = process.env.DATABASE_URL ?? "sqlite:///data/gachipad.db";
    const source = url.startsWith("sqlite:") && !url.startsWith("sqlite://")
      ? url.slice("sqlite:".length) : decodeURIComponent(new URL(url).pathname);
    const dataDirectory = dirname(source);
    for (const name of readdirSync(dataDirectory)) {
      if (name.startsWith(".gachipad-backup-") || name.startsWith(".gachipad-validate-") || name === `${basename(source)}.restore`)
        rmSync(join(dataDirectory, name), { recursive: true, force: true });
    }
    const bytes = BigInt(process.env.GACHIPAD_SQLITE_BYTES);
    const space = statfsSync(dataDirectory, { bigint: true });
    const required = bytes + (bytes / 5n > 67108864n ? bytes / 5n : 67108864n);
    if (space.bavail * space.bsize < required)
      throw new Error("SQLite data filesystem has insufficient free space for a snapshot or restore (database size plus 20%, at least 64 MiB extra required)");
    const directory = mkdtempSync(join(dataDirectory, ".gachipad-validate-"));
    const path = join(directory, "snapshot.db");
    const cleanup = () => rmSync(directory, { recursive: true, force: true });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.once(signal, () => { cleanup(); process.exit(1); });
    try {
      await pipeline(process.stdin, createWriteStream(path, { mode: 0o600 }));
      const header = Buffer.alloc(16), fd = openSync(path, "r");
      try { readSync(fd, header, 0, 16, 0); } finally { closeSync(fd); }
      if (header.toString() !== "SQLite format 3\0")
        throw new Error("Not a SQLite backup");
      const db = new DatabaseSync(path);
      const result = db.prepare("PRAGMA integrity_check").get();
      db.close();
      if (Object.values(result ?? {})[0] !== "ok") throw new Error("SQLite integrity check failed");
    } finally { cleanup(); }
  '
}

sqlite_restore() {
  local bytes
  sqlite_validate "$1" || { echo "SQLite backup validation failed; database unchanged" >&2; return 1; }
  sqlite_backup ./backups >&2 || return 1
  bytes="$(gzip -dc -- "$1" | wc -c)" || return 1
  gzip -dc -- "$1" | docker compose run --rm --no-deps -T -e GACHIPAD_SQLITE_BYTES="$bytes" --entrypoint node api --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    import { createWriteStream, renameSync, rmSync, readdirSync, statfsSync } from "node:fs";
    import { pipeline } from "node:stream/promises";
    const url = process.env.DATABASE_URL ?? "sqlite:///data/gachipad.db";
    const destination = url.startsWith("sqlite:") && !url.startsWith("sqlite://")
      ? url.slice("sqlite:".length) : decodeURIComponent(new URL(url).pathname);
    import { basename, dirname, join } from "node:path";
    const dataDirectory = dirname(destination);
    for (const name of readdirSync(dataDirectory)) {
      if (name.startsWith(".gachipad-backup-") || name.startsWith(".gachipad-validate-") || name === `${basename(destination)}.restore`)
        rmSync(join(dataDirectory, name), { recursive: true, force: true });
    }
    const bytes = BigInt(process.env.GACHIPAD_SQLITE_BYTES);
    const space = statfsSync(dataDirectory, { bigint: true });
    const required = bytes + (bytes / 5n > 67108864n ? bytes / 5n : 67108864n);
    if (space.bavail * space.bsize < required)
      throw new Error("SQLite data filesystem has insufficient free space for a snapshot or restore (database size plus 20%, at least 64 MiB extra required)");
    const path = `${destination}.restore`;
    const cleanup = () => rmSync(path, { force: true });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.once(signal, () => { cleanup(); process.exit(1); });
    try {
      await pipeline(process.stdin, createWriteStream(path, { mode: 0o600 }));
      const db = new DatabaseSync(path);
      const result = db.prepare("PRAGMA integrity_check").get();
      db.close();
      if (Object.values(result ?? {})[0] !== "ok") throw new Error("SQLite integrity check failed");
      rmSync(`${destination}-wal`, { force: true });
      rmSync(`${destination}-shm`, { force: true });
      renameSync(path, destination);
    } finally { cleanup(); }
  '
}

postgres_validate() {
  # Consume the full stream before listing the TOC, which may otherwise close stdin early.
  # shellcheck disable=SC2016 # expanded only inside the database container
  gzip -dc -- "$1" | docker compose exec -T postgres sh -c '
    set -eu
    umask 077
    archive="$(mktemp)"
    trap '\''rm -f "$archive"'\'' EXIT
    cat >"$archive"
    pg_restore --list "$archive" >/dev/null
  '
}

postgres_restore() {
  local safety
  postgres_validate "$1" || { echo "PostgreSQL backup validation failed; database unchanged" >&2; return 1; }
  safety="$(postgres_backup ./backups)" || return 1
  printf '%s\n' "$safety" >&2
  # Restore away from the live DB, then rename both databases in one transaction.
  # Writers are stopped; a failed restore or swap leaves the live database intact.
  # shellcheck disable=SC2016 # expanded only inside the database container
  if ! gzip -dc -- "$1" | docker compose exec -T postgres sh -c '
    set -eu
    stage="gp_restore_$(date +%s)_$$"
    old="gp_previous_$(date +%s)_$$"
    trap '\''dropdb --if-exists --force --maintenance-db=template1 --username="$POSTGRES_USER" -- "$stage" >/dev/null 2>&1 || true'\'' EXIT
    createdb --maintenance-db=template1 --username="$POSTGRES_USER" --owner="$POSTGRES_USER" -- "$stage"
    pg_restore --exit-on-error --no-owner --username="$POSTGRES_USER" --dbname="$stage" --single-transaction
    psql --no-psqlrc --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname=template1 \
      --set=live="$POSTGRES_DB" --set=stage="$stage" --set=old="$old" <<'\''SQL'\''
BEGIN;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'\''live'\'' AND pid <> pg_backend_pid();
ALTER DATABASE :"live" RENAME TO :"old";
ALTER DATABASE :"stage" RENAME TO :"live";
COMMIT;
SQL
    dropdb --force --maintenance-db=template1 --username="$POSTGRES_USER" -- "$old" ||
      echo "PostgreSQL restored; could not remove previous database $old" >&2
  '; then
    echo "PostgreSQL restore failed; live database unchanged; safety $safety" >&2
    return 1
  fi
}

database_backup() {
  case "$(database_kind)" in
    mongodb) mongo_backup "$1" ;;
    postgres) postgres_backup "$1" ;;
    sqlite) sqlite_backup "$1" ;;
    external)
      echo "backup: DATABASE_URL uses an external database; no local backup was made. Back up the external server with its own tools before updates or restores." >&2
      [ "${GACHIPAD_EXTERNAL_BACKUP_CONFIRMED:-$(env_get GACHIPAD_EXTERNAL_BACKUP_CONFIRMED)}" = 1 ]
      ;;
  esac
}

database_validate() {
  case "$(database_kind)" in
    mongodb) mongo_transfer validate <"$1" ;;
    postgres) postgres_validate "$1" ;;
    sqlite) sqlite_validate "$1" ;;
    external) die "external databases cannot be restored from a local gachipad backup; use the external server's restore tools" ;;
  esac
}

database_restore() {
  case "$(database_kind)" in
    mongodb) mongo_restore "$1" ;;
    postgres) postgres_restore "$1" ;;
    sqlite) sqlite_restore "$1" ;;
    external) die "external databases cannot be restored from a local gachipad backup; use the external server's restore tools" ;;
  esac
}

# legacy codesh name (1.0.x); remove in 2.0
# Reserve space for both the pre-update dump and the safety dump used during recovery.
backup_space() {
  local latest bytes free
  latest="$(find backups -maxdepth 1 \( -name 'gachipad-*.archive.gz' -o -name 'codesh-*.archive.gz' \) -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d ' ' -f 2- || true)"
  [ -n "$latest" ] || return 0
  bytes="$(wc -c <"$latest")" || return 1
  free="$(df -Pk backups | awk 'NR == 2 {print $4}')" || return 1
  [ "$((free * 1024))" -ge "$((bytes * 2))" ] || {
    echo "insufficient free space: need twice the last backup size before maintenance" >&2; return 1;
  }
}

# SHA-256 detects corruption and mismatch; obtain the checksum via a trusted delivery channel.
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1;
  else shasum -a 256 "$1" | cut -d ' ' -f 1; fi
}

verify_archive() {
  local expected manifest
  if [ -f "$1.sha256" ]; then
    expected="$(awk 'NR == 1 {print $1}' "$1.sha256")"
  else
    manifest="$(dirname "$1")/SHA256SUMS"
    [ -f "$manifest" ] || die "missing checksum: $1.sha256 or $manifest"
    expected="$(awk -v f="$(basename "$1")" '$2 == f || $2 == "*" f || $2 == "./" f {print $1}' "$manifest")"
  fi
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || die "invalid archive checksum"
  [ "$(sha256_file "$1")" = "$expected" ] || die "bundle checksum mismatch"
}

verify_bundle() {
  local dir="$1"
  [ -f "$dir/SHA256SUMS" ] || die "bundle SHA256SUMS is missing"
  (cd "$dir" && {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum --quiet --strict -c SHA256SUMS;
    else shasum -a 256 --quiet -c SHA256SUMS; fi
  }) || die "bundle content checksum mismatch"
}

# legacy codesh name (1.0.x); remove in 2.0
# Environment compatibility is startup-only and warns once per run (children inherit the marker),
# without printing any values. Only real environment variables warn: the migration comments the
# old lines out of .env, and env_get still reads an old-style .env silently.
legacy_env_names=()
while read -r legacy_env_name; do
  [[ "$legacy_env_name" == CODESH_* ]] || continue
  legacy_env_names+=("$legacy_env_name")
  new_env_name="GACHIPAD_${legacy_env_name#CODESH_}"
  if [ -z "${!new_env_name+x}" ]; then export "$new_env_name=${!legacy_env_name}"; fi
done < <(compgen -e)
if [ "${#legacy_env_names[@]}" -gt 0 ] && [ -z "${GACHIPAD_LEGACY_ENV_WARNED:-}" ]; then
  export GACHIPAD_LEGACY_ENV_WARNED=1
  echo "warning: legacy CODESH_ settings are deprecated; use GACHIPAD_ settings" >&2
fi
