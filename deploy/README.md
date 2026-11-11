# Deploying gachipad

One Docker host runs the whole stack (docs/ARCHITECTURE.md §1): **Caddy** (static web app, `/api`, `/collab`), **api**, **collab** (one or more), the selected database (SQLite by default, bundled PostgreSQL 17, bundled MongoDB 8, or an external database), and **Valkey 8**. Only Caddy publishes ports. Everything needed at runtime is in the images: no CDN, font service or other outside request.

## Images

Releases publish `ghcr.io/kim0040/gachipad-web` (Caddy with the web app), `gachipad-api`, `gachipad-collab` and `gachipad-mdns` for linux/amd64 and linux/arm64, tagged `X.Y.Z`, `X.Y`, `X` and `latest`. They are public: pulling needs no login. `docker-compose.yml` names `${GACHIPAD_REGISTRY}/gachipad-*:${GACHIPAD_VERSION}`; set `GACHIPAD_REGISTRY` to a mirror that keeps the digests if the host cannot reach ghcr.io.

## From the repository

```sh
cd deploy
./install.sh                                      # online mode: pulls released images, writes .env, starts stack
curl http://localhost/healthz
```

When running from `deploy/` of a git clone without `images.tar`, `install.sh` operates in online mode. It skips bundle checksum verification, reads the version from `.env.example`, and pulls released container images from the registry using `docker compose pull`. If the host has no internet access, the installer halts without modifying `.env`:
`no internet: use the offline bundle (registry unavailable, authentication denied or release images missing); .env was not changed`

- Run `./install.sh --check` to test host prerequisites first without changing any configuration or creating `.env`.
- Pass `--yes` to accept defaults and run unattended installations without interactive prompts.

### Manual Docker Compose alternative

As an alternative to `install.sh`, you can configure and run the stack directly using Docker Compose:

```sh
cd deploy
cp .env.example .env && ./generate-secrets.sh     # once; .env stays on the host
docker compose pull && docker compose up -d       # the release GACHIPAD_VERSION from GHCR
docker compose up -d --build                      # or: build api, collab and the Caddy image from these sources
curl http://localhost/healthz
```

`docker compose build` builds the images from the checkout and tags them with `GACHIPAD_VERSION`, which must equal the root `package.json` version (the Dockerfiles check); `docker compose pull` fetches the released images of that version instead. After `git pull`, build again.

`.env.example` documents every variable. Secrets are random hex written by `generate-secrets.sh`; it never overwrites a value that is set. Always run `./generate-secrets.sh .env` after changing database passwords. `MONGO_PASSWORD` and `POSTGRES_PASSWORD` only seed a new volume: rotate the database role password inside the database server as well when changing existing credentials.

## Database choices

gachipad supports multiple database backends, selected during installation or configured via `.env`:

- **SQLite** (default for new installs): Stored in `/data/gachipad.db` on the shared `gachipad-data` volume in WAL mode. Requires no server setup, external credentials, or extra containers. Recommended for single-host deployments. Budget at least twice the uncompressed database size as free operational disk headroom for snapshots and restores.
- **Bundled PostgreSQL**: Runs `postgres:17.11-alpine` under Compose profile `postgres`. Multi-replica collab scale-out ready. Password generated automatically.
- **Bundled MongoDB**: Runs `mongo:8.0.34` under Compose profile `mongodb`. Upgraded 1.0.x installations retain MongoDB automatically without data migration. On Linux kernels 6.19 up to 7.0.13 (and Ubuntu kernels reported as `7.0.0-NN` by `uname -r`), MongoDB 8.0.34 deliberately refuses to start to avoid crashes and data corruption (`cat /proc/version_signature` shows the upstream version). Operators can boot a kernel older than 6.19, migrate data to SQLite or PostgreSQL with `migrate-db.sh` while MongoDB can start, or choose SQLite or PostgreSQL for new installs (docs/OPERATIONS.md §13.2). MongoDB 8.0.35 recognises Ubuntu kernels and will be adopted in a patch release once published.
- **External database**: Connect to external PostgreSQL, MySQL, MariaDB, or MongoDB via `DATABASE_URL` (`GACHIPAD_DB=external`). MySQL and MariaDB are supported as external servers only; bundled images are not provided for them.
- **Valkey**: Required for every database choice (document locks, presence, rate limits, join codes).

## Installation with --db

```sh
./install.sh [--check] [--yes] [--db sqlite|postgres|mongodb|external] [--database-url URL] [--network internal|public]
```

- **Interactive detection**: On a TTY, the installer inventories local database ports (5432, 3306, 27017), running containers, installed client CLI tools, and available memory, prompting for the backend with SQLite as the recommended default.
- **Non-interactive installs**: Default to SQLite unless `--db` or `DATABASE_URL` is passed.
- **External database connection**: If `--db external` is selected without a URL on a TTY, a hidden input prompt asks for `DATABASE_URL`. Multiline values are rejected, and URLs are stored single-quoted in `.env` to preserve special characters (`$`, `#`, spaces).
- **Backend guard**: Refuses switching if non-empty data volumes or a recorded marker from another backend exist (`database backend change refused; use ./migrate-db.sh to copy data and switch backends`).

## Host preflight checks (preflight.sh)

`install.sh` automatically runs host validation checks from `deploy/preflight.sh` (`preflight_run`) before configuring `.env` or starting containers. To test host prerequisites without changing any settings or files, run:

```sh
./install.sh --check
```

`--check` performs read-only checks and exits immediately without modifying host settings (`no host settings changed.`). Each check returns pass (`[ok]`), a warning (`[warn]`), or a failure (`[fail]`). The script prints a summary (`preflight: %s failure(s), %s warning(s); no host settings changed.`) and exits with a non-zero code if any failure is encountered.

These checks are best-effort and were verified on Ubuntu only; other distributions, arm64, rootless Docker and SELinux hosts were not verified.

Summary of preflight checks:

1. **Filesystem (`filesystem`)**:
   - `fail`: Installation path contains whitespace (`installation path contains whitespace`). Fix: `move the installation to a Linux filesystem path without spaces/newlines, such as /opt/gachipad`.
   - `fail`: Filesystem type is FAT, NTFS, fuseblk, 9p, or drvfs (`filesystem <type> cannot preserve Linux install permissions`). Fix: `move the installation onto a Linux filesystem (WSL 2: use ~/gachipad, not /mnt/c)`.
   - `fail`: Installation filesystem mounted with `noexec` (`installation filesystem is mounted noexec`). Fix: `move the installation to an executable Linux filesystem, such as /opt/gachipad`.
   - `warn`: Filesystem type or mount options unknown (`filesystem type or mount options are unknown`). Fix: `findmnt -T .; verify a Linux filesystem mounted with exec`.

2. **Docker CLI (`cli`)**:
   - `fail`: Docker CLI is missing (`Docker CLI is missing`). Fix line printed per distribution from `/etc/os-release`:
     - Ubuntu/Debian/Raspbian: `sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 (if unavailable, configure https://docs.docker.com/engine/install/ and install docker-ce docker-ce-cli containerd.io docker-compose-plugin)`
     - Fedora: `sudo dnf install -y moby-engine docker-compose`
     - RHEL/CentOS/Rocky/AlmaLinux: `sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo && sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin (use yum on older hosts)`
     - SUSE/openSUSE: `sudo zypper install docker docker-compose`
     - Arch: `sudo pacman -S docker docker-compose`
     - Other: `install Docker Engine and its Compose plugin: https://docs.docker.com/engine/install/`
   - `fail`: Podman Docker emulation detected in `docker version` (`Podman Docker emulation is not supported; install Docker Engine`). Fix: distribution-specific hint as above.

3. **Docker daemon (`daemon`)**:
   - `fail`: Docker socket permission denied (`Docker socket permission denied`). Fix: `sudo usermod -aG docker "$USER"; then log out and log in again, or run sudo ./install.sh`.
   - `fail`: Docker daemon unavailable (`Docker daemon is unavailable`). Fix: `sudo systemctl enable --now docker (rootless: systemctl --user start docker; WSL 2: enable systemd or Docker Desktop integration)`.
   - `fail`: Podman detected in `docker info` (`Podman is not supported; install Docker Engine`). Fix: distribution-specific hint as above.

4. **Docker Compose (`compose`)**:
   - `fail`: Compose v2 plugin missing (`Compose v2 plugin is missing (legacy docker-compose v1 is not supported)`). Fix: distribution-specific hint as above.
   - `fail`: Compose version below 2.20.0 (`need Compose >=2.20.0 for depends_on.required; up --wait alone needs >=2.1.1`). Fix: distribution-specific hint as above.
   - `warn`: Compose version cannot be parsed (`Compose version is unknown`). Fix: `docker compose version; install Compose >=2.20.0`.

5. **Readiness probe tool (`curl`)**:
   - `fail`: `curl` is missing for the required `/healthz` readiness check (`curl is missing; installation readiness cannot be checked`). Fix line printed per distribution:
     - Ubuntu/Debian/Raspbian: `sudo apt-get install -y curl`
     - Fedora/RHEL/CentOS/Rocky/AlmaLinux: `sudo dnf install -y curl (use yum on older hosts)`
     - SUSE/openSUSE: `sudo zypper install curl`
     - Arch: `sudo pacman -S curl`
     - Other: `install curl with your distribution package manager`

6. **Port configuration (`ports_config`)**:
   - `fail`: `HTTP_PORT` or `HTTPS_PORT` outside 1-65535 (`HTTP_PORT and HTTPS_PORT must be integers from 1 to 65535`). Fix: `HTTP_PORT=8080 HTTPS_PORT=8443 ./install.sh`.
   - `fail`: `HTTP_PORT` equals `HTTPS_PORT` (`HTTP_PORT and HTTPS_PORT must differ`). Fix: `HTTP_PORT=8080 HTTPS_PORT=8443 ./install.sh`.

7. **Rootless Docker (`rootless`)**:
   - `warn`: Security options unreadable (`Docker security mode is unknown`). Fix: `docker info --format "{{json .SecurityOptions}}"`.
   - `fail`: Privileged ports (< 1024) selected without kernel unprivileged port start permission (`rootless Docker cannot bind the selected privileged ports`). Fix: `HTTP_PORT=8080 HTTPS_PORT=8443 ./install.sh; or sudo sysctl -w net.ipv4.ip_unprivileged_port_start=0 (persist in /etc/sysctl.d/ for reboot)`.

8. **Port availability (`ports`)**:
   - `warn`: Port listing tools missing (`listening ports are unknown (no ss, netstat or /proc/net/tcp)`). Fix: `install iproute2 (ss), then rerun ./install.sh --check`.
   - `fail`: Target TCP port already bound by another process (`host TCP port <port> is already in use: <line>`). Bindings owned by this installation's Caddy container are recognized and skipped. Fix: `stop the named listener, or HTTP_PORT=8080 HTTPS_PORT=8443 ./install.sh`.

9. **Architecture (`architecture`)**:
   - `warn`: Daemon architecture unknown (`daemon architecture is unknown`). Fix: `docker info --format "{{.Architecture}}"`.
   - `fail`: Unsupported host architecture (`released images support amd64 and arm64 only`). Fix: `use a 64-bit amd64/arm64 Docker host (Raspberry Pi: install 64-bit Raspberry Pi OS)`.
   - `warn`: Offline bundle architecture cannot be determined (`offline bundle architecture is unknown`). Fix: `use a bundle named gachipad-<version>-linux-amd64 or -linux-arm64 matching docker info`.
   - `fail`: Bundle architecture does not match Docker host (`bundle <bundle> does not match Docker <host>`). Fix: `use the linux-<host> offline bundle`.

10. **Disk space (`disk`)**:
    - `fail`: Insufficient free space (`need <required> bytes at Docker root (2 x images.tar + 2 GiB), and 100 MiB at install folder`). Fix: `df -h; free space on the indicated filesystem or move Docker data-root/install folder to a larger Linux disk (do not prune shared resources)`.
    - `warn`: Free space cannot be determined (`free space at Docker root or install folder is unknown`). Fix: `sudo df -Pk; verify <required> bytes at Docker root and 100 MiB at install folder`.

11. **Memory (`memory`)**:
    - `warn`: Total RAM unknown (`total memory is unknown`). Fix: `provision at least 2 GiB RAM (MongoDB: 4 GiB recommended)`.
    - `fail`: Host RAM below 2 GiB (`only <total> KiB RAM; need at least 2 GiB`). Fix: `add RAM or increase the VM/WSL 2 memory limit to at least 2 GiB`.
    - `warn`: MongoDB selected on host with less than 4 GiB RAM (`MongoDB on less than 4 GiB RAM`). Fix: `MONGO_CACHE_GB=1 ./install.sh --db mongodb (persist MONGO_CACHE_GB=1 in .env)`.

12. **SELinux (`selinux`)**:
    - Non-enforcing modes (Permissive, Disabled, 0, or not detected) pass as ok.
    - `warn`: SELinux state unknown (`SELinux state is unknown`). Fix: `getenforce; verify bind mounts have :z or :Z`.
    - `warn`: Compose file missing for inspection (`compose file is unavailable for bind mount inspection`). Fix: `restore docker-compose.yml from the release`.
    - `fail`: SELinux enforcing with unlabelled bind mounts (`SELinux enforcing with unlabelled bind mounts`). Fix: `add :z to the access options of bind mounts in docker-compose.yml (shipped tls and state use :ro,z)`.

13. **Firewall (`firewall`)**:
    - `warn`: ufw active (`ufw is active; allow the selected TCP ports`). Fix (public): `sudo ufw allow to any port $PF_HTTP proto tcp; sudo ufw allow to any port $PF_HTTPS proto tcp`; Fix (internal): `sudo ufw allow from <LAN_SUBNET_CIDR> to any port $PF_HTTP proto tcp; sudo ufw allow from <LAN_SUBNET_CIDR> to any port $PF_HTTPS proto tcp`.
    - `warn`: firewalld active (`firewalld is active; allow ports in the ingress zone`). Fix (public): `sudo firewall-cmd --permanent --add-port=$PF_HTTP/tcp --add-port=$PF_HTTPS/tcp; sudo firewall-cmd --reload`; Fix (internal): `sudo firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=<LAN_SUBNET_CIDR> port port=$PF_HTTP protocol=tcp accept'; sudo firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=<LAN_SUBNET_CIDR> port port=$PF_HTTPS protocol=tcp accept'; sudo firewall-cmd --reload`.
    - `warn`: nftables input default drop active (`nftables input default drop is active; allow ports before drop rules`). Fix (public): `sudo nft insert rule <chain> tcp dport { $PF_HTTP, $PF_HTTPS } accept; persist with your distribution firewall manager`; Fix (internal): `sudo nft insert rule <chain> ip saddr <LAN_SUBNET_CIDR> tcp dport { $PF_HTTP, $PF_HTTPS } accept; persist with your distribution firewall manager`.
    - `warn`: Firewall status cannot be queried (`firewall state is unknown (tools missing or permission denied)`). Fix: `sudo nft list ruleset; check host/router rules for the selected ports (internal: restrict to the LAN subnet)`.

14. **Clock synchronization (`clock`)**:
    - `warn`: System clock not NTP-synchronized in public mode (`system clock is not synchronized or unknown; ACME may fail`). Fix: `sudo timedatectl set-ntp true; timedatectl status (without systemd: enable chronyd or another NTP client)`. In internal network mode, this check is skipped.

15. **Docker at boot (`boot`)**:
    - `warn`: systemctl missing (`Docker boot enablement is unknown (systemctl missing)`). Fix: `enable Docker with your init system; containers already use restart: unless-stopped`.
    - `warn`: Docker service not enabled at boot (`Docker is not enabled at boot, or service status is unknown`). Fix: `systemctl enable docker (use sudo for a system service); containers already have restart policies` (rootless: `systemctl --user enable docker ...`).

16. **Cascading warnings when Docker is unavailable**:
    - If Docker CLI or daemon checks fail, dependent probes (`daemon`, `compose`, `rootless`, `architecture`, `disk`, `boot`) output:
      `[warn] <check>: unknown until Docker is available`.

## Network deployment modes

`install.sh` supports two deployment modes: internal network mode (`--network internal`, default) and hardened public internet mode (`--network public`).

### Selection and flags

```sh
# Internal network mode (default):
./install.sh --network internal

# Public internet mode with automatic Caddy ACME HTTPS:
./install.sh --network public --domain share.example.org [--acme-email ops@example.org]

# Public internet mode behind an external TLS reverse proxy:
PUBLIC_URL=https://share.example.org ./install.sh --network public --behind-proxy 192.0.2.7/32
```

- **Interactive prompt**: On a TTY without explicit flags, `install.sh` prompts for `internal` or `public`. Non-interactive executions default to `internal`.
- **Public domain validation**: `--domain` (or `PUBLIC_URL=https://...`) must be a domain you own with an A DNS record pointing to the host's public IPv4 address (or the TLS proxy). An AAAA record should only be published after setting up a source-preserving dual-stack Docker network (see [docs/OPERATIONS.md §17.2](../docs/OPERATIONS.md#172-공개-인터넷-모드의-주요-변경-사항)). IP addresses, `.local`, single-label names, `.test`, `.example`, and `.invalid` are rejected. Ports 80 and 443 must reach Caddy.
- **Behind proxy (`--behind-proxy <CIDR>`)**: Used when an external proxy terminates TLS and forwards HTTP to Caddy. The CIDR must be a non-universal prefix (IPv4 >= /8, IPv6 >= /32) and must not overlap `NETWORK_SUBNET`. A single-host CIDR (`/32` or `/128`) is recommended; prefixes wider than `/16` trigger a warning. The proxy must supply `X-Forwarded-For` and `X-Forwarded-Proto: https`. Connections outside that CIDR are rejected with `403 Forbidden`.
- **Switching modes on existing installs**: Re-running `install.sh` without `--network` preserves the stored mode in `.env`. Switching `internal -> public` saves prior settings as `GACHIPAD_INTERNAL_*` and applies strict public limits. Switching `public -> internal` restores saved `GACHIPAD_INTERNAL_*` values while retaining tightened security limits for operator review.
- **Transactional rollback**: `.env` is backed up to a private snapshot before changes and restored if container startup, `/healthz` or `/readyz` checks fail.

### What changes in public mode

- **HTTPS and HSTS**: Caddy serves automatic HTTPS (via Let's Encrypt or ZeroSSL) and sends `Strict-Transport-Security: max-age=31536000` and `X-Robots-Tag: noindex`. Files in `deploy/tls/*.caddy` are ignored in public mode. Session cookies enforce `Secure`, `HttpOnly`, and `SameSite=Lax`.
- **Admin CIDR restriction**: Empty or default `ADMIN_ALLOW_CIDR` restricts admin endpoints to loopback and private ranges (`127.0.0.0/8,::1/128,10.0.0.0/8,192.168.0.0/16,fc00::/7`; `172.16.0.0/12` is excluded). Unauthorized clients receive 404 before auth handling. Add your public IP to `ADMIN_ALLOW_CIDR` in `.env` to widen access. Admin authentication uses `Authorization: Bearer <ADMIN_TOKEN>`.
- **mDNS off**: The mDNS profile is removed, any running mDNS advertiser is stopped, and `./mdns.sh enable` is rejected.
- **Per-client discovery isolation**: Public sessions without an explicit room are placed into individual discovery groups (`client:<id>`). Implicit nearby document previews and broadcasts across /24 or /64 subnets are disabled.
- **Stricter limits in `.env`**:
  - `RATE_LIMIT_API_PER_MIN=300` (internal: 1200)
  - `RATE_LIMIT_CODE_PER_MIN=10` (internal: 30)
  - `RATE_LIMIT_CODE_GLOBAL_FAILURES_PER_MIN=300` (public-only shared fleet budget)
  - `RATE_LIMIT_CREATE_PER_MIN=10` (internal: 60)
  - `RATE_LIMIT_LOGIN_PER_MIN=5` (internal: 10)
  - `QUOTA_SHARES_PER_CLIENT=50` (internal: 200); `QUOTA_SHARES_PER_IP=200` (internal: 1000)
  - `QUOTA_UPLOADS_PER_CLIENT=50` (internal: 200); `QUOTA_UPLOADS_PER_IP=200` (internal: 1000)
  - `QUOTA_BYTES_PER_CLIENT=104857600` / 100 MiB (internal: 512 MiB)
  - `QUOTA_BYTES_PER_IP=536870912` / 512 MiB (internal: 2 GiB)
  - `UPLOAD_STORAGE_MAX_BYTES=2147483648` / 2 GiB (internal: 10 GiB)
  - `SSE_MAX_PER_CLIENT=5` (internal: 20); `SSE_MAX_PER_IP=50` (internal: 200)
  - `PRESENCE_MAX_PER_NET=100` (internal: 500)
  - For large shared NAT networks (schools, corporate egress), raise `SSE_MAX_PER_IP`, `RATE_LIMIT_API_PER_MIN`, and `RATE_LIMIT_CODE_PER_MIN`.
- **Join-code failure budget**: A Valkey fixed-minute counter limits failed 6-digit code lookups fleet-wide to 300/min. Clean addresses (IPv4 or IPv6 /48) without recent failures get one free miss (up to 3x budget fleet-wide). A source that looks up a valid code is treated as clean again, but total guesses stay within the shared budget plus the free allowance (3 x RATE_LIMIT_CODE_GLOBAL_FAILURES_PER_MIN per minute fleet-wide). If the budget is exhausted during a scan attack, code joins are paused and return 429 (`Retry-After`), but direct share links (`/<id>`), existing sessions, and ordinary API operations keep working.
- **Upload pool per-address cap**: In-flight and held uploads are tracked per IPv4 or IPv6 /64, capped at `floor(UPLOAD_STORAGE_MAX_BYTES/4)` (512 MiB default). Exceeding this returns HTTP 429 (`upload_pool_limited`).
- **Unknown client rule**: If forwarded IP resolution ends inside `TRUST_PROXY` or headers are malformed, the client IP becomes `unknown`. Unknown clients share a conservative rate-limit bucket and cannot satisfy `ADMIN_ALLOW_CIDR`. If `unknown` requests exceed 5% over 5 minutes, `/api/admin/overview` sets `unknownClientIdentity: true`.
- **IPv4-only binding default**: Public installs default to `GACHIPAD_BIND_ADDRESS=0.0.0.0:`. Publishing IPv6 without source-preservation can map external clients to Docker bridge gateway addresses. IPv6 requires an operator-managed dual-stack Docker network with `ip6tables` enabled and `userland-proxy` disabled.
- **Metrics scraping**: `/metrics/api` and `/metrics/collab` require loopback or compose network sources and refuse requests arriving through the compose gateway (403). Scrape from within Caddy or a container on the compose network.
- **Proxy idle timeout**: Set upstream keepalive/idle timeout on external reverse proxies below 120 s (Caddy public idle timeout is 2m).
- **Guest document creation**: Guests can create documents by default. To close the site, set `guestAllowed=false` in the admin console and configure OIDC or LDAP.

## Windows installer (WSL 2)

gachipad runs on Windows 10/11 using WSL 2 and Docker Desktop.

### Requirements

- 64-bit Windows 10 22H2 (build 19045) or Windows 11 (build 22000+). 32-bit Windows is not supported.
- CPU virtualization enabled in UEFI/BIOS and Windows features (`HypervisorPresent`).
- WSL 2 with a supported Linux distro (e.g. Ubuntu; Docker Desktop helper distros `docker-desktop` and `docker-desktop-data` are excluded).
- Docker Desktop with WSL integration enabled for the distro (or Docker Engine inside WSL with `systemd=true`).
- Windows PowerShell 5.1 or PowerShell 7+.

### Installation

Run `install.cmd` or invoke `install.ps1` from PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\install.ps1 -Network internal
```

Switches:
- `-Network internal|public`: Choose network mode.
- `-Domain <domain>`, `-AcmeEmail <email>`, `-BehindProxy <CIDR>`: Configure public internet mode (`-BehindProxy 192.0.2.7/32`, forwarded as `--behind-proxy <CIDR>`).
- `-Db sqlite|postgres|mongodb|external`, `-DatabaseUrl <URL>`: Select database backend.
- `-Distro <distro>`: Target WSL distribution.
- `-InstallDir <dir>`: Target directory inside WSL Linux filesystem (default `~/gachipad`). Must not be on a Windows mount (`/mnt/c` or drvfs/9p).
- `-OpenFirewall`: Automatically add inbound firewall rules (requires Administrator elevation).
- `-InstallWsl`: Automatically run `wsl --install -d Ubuntu` if WSL is missing (requires elevation and reboot).
- `-BundlePath <archive.tar.gz>`: Path to an offline bundle archive.
- `-InstallArgs <arguments>`: Additional arguments forwarded to Linux `install.sh`.

### Error messages and troubleshooting

- **OS / Virtualization**:
  - `A 64-bit version of Windows is required...`: Upgrade to 64-bit Windows.
  - `Supported hosts are 64-bit Windows 10 22H2 (build 19045) or Windows 11...`: Upgrade Windows.
  - `Virtualization: not detected...`: Enable VT-x/AMD-V in UEFI and Virtual Machine Platform in Windows features.
- **WSL 2 / Distro**:
  - `WSL 2 is not available...`: Run `wsl --install -d Ubuntu` in elevated PowerShell and reboot.
  - `No WSL distribution is installed...`: Install Ubuntu via `wsl --install -d Ubuntu` and finish initial setup.
  - `WSL distro '<distro>' is version 1...`: Convert with `wsl --set-version '<distro>' 2`.
  - `WSL distro '<distro>' was not found...`: Choose an installed distro name.
  - `Could not read WSL distribution versions...`: Run `wsl --update` then retry.
- **Docker**:
  - `Docker socket permission was denied...`: Run `sudo usermod -aG docker $USER` inside WSL, then `wsl --shutdown`.
  - `Docker Desktop is installed but is not running...`: Start Docker Desktop.
  - `Docker Desktop is running, but WSL integration is off...`: Enable WSL Integration in Docker Desktop Settings > Resources > WSL Integration.
  - `Docker Engine is installed inside '<distro>' without systemd...`: Add `[boot]\nsystemd=true` to `/etc/wsl.conf` and run `wsl --shutdown`.
  - `Docker is not available...`: Install Docker Desktop or Docker Engine.
  - `Docker Compose is missing...`: Install the Docker Compose plugin.
- **Filesystem / Source**:
  - `InstallDir must be inside the WSL Linux filesystem, not /mnt/c...` (exit 42): Select a native Linux path like `~/gachipad`.
  - `The source does not contain install.sh...` (exit 43): Provide a valid offline bundle or deploy folder.
  - `images.tar is missing...` (exit 44): Use the full offline bundle (`gachipad-*`), not the deploy-only bundle (`gachipad-deploy-*`).
  - `A copied .sh file has CR line endings...` (exit 45): Set `git config core.autocrlf false` and check out with LF line endings.
  - `Bundle checksum mismatch...`: Re-download the bundle and `.sha256` sidecar.

### Firewall and networking

- **Firewall**: With `-OpenFirewall`, adds inbound TCP rules for HTTP (`HTTP_PORT`, 80) and HTTPS (`HTTPS_PORT`, 443) named `'gachipad HTTP'` and `'gachipad HTTPS'`. Profiles: `Domain, Private` (internal mode) or `Domain, Private, Public` (public mode). Without elevation, prints manual `New-NetFirewallRule` commands.
- **NAT vs Mirrored networking**:
  - Docker Desktop automatically forwards container ports to the Windows host.
  - For standalone Docker Engine in WSL 2 NAT mode, external machines cannot reach WSL ports by default. Enable mirrored networking (Windows 11 22H2+: add `networkingMode=mirrored` under `[wsl2]` in `%USERPROFILE%\.wslconfig`, then run `wsl --shutdown`), or configure `netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=80 connectaddress=<WSL_IP> connectport=80`.

### State and command wrapper

- State is saved in `%LOCALAPPDATA%\gachipad\install.json` (`Distro`, `InstallDir`).
- Application files reside inside the WSL Linux filesystem (`~/gachipad`).
- Manage the installation using `gachipad.ps1`:
  ```powershell
  .\deploy\gachipad.ps1 update --check
  .\deploy\gachipad.ps1 backup
  .\deploy\gachipad.ps1 logs
  ```
  Validates script names case-sensitively against installed `.sh` files and blocks `lib.sh` or path traversal.

### Known unverified areas

The Windows installer is tested with automated Pester suites and mocked WSL execution, but physical verification across every Windows build, non-English Windows locales (e.g. Korean/German wsl.exe decoding), ConPTY terminal interactions with Ctrl-C, physical firewall rules, and Docker Desktop source-IP preservation remains ongoing.

## Backups and restores

- **Backup (`./backup.sh [dir]`)**: Default directory `./backups`. Backups are written with `0600` permissions into a `0700` directory.
  - **SQLite**: Online `VACUUM INTO` snapshot inside the data volume, streamed directly to gzip. No live WAL lock is copied.
  - **PostgreSQL**: `pg_dump --format=custom` wrapped in gzip.
  - **MongoDB**: `mongodump` compressed archive.
  - **External**: Creates no local archive. Operators must use the external database's native tools and set `GACHIPAD_EXTERNAL_BACKUP_CONFIRMED=1` before updates or maintenance.
- **Restore (`./restore.sh <archive.gz> [--yes]`)**:
  - Validates archive integrity and takes a safety backup of the existing database before stopping writers and replacing data.
  - **SQLite**: Verifies SQLite 3 header and `PRAGMA integrity_check`, requires source size plus 20% (at least 64 MiB extra) disk headroom, writes to `<dest>.restore`, removes stale `-wal`/`-shm`, and atomically renames the restored file.
  - **PostgreSQL**: Verifies archive TOC, restores into a unique temporary database (`gp_restore_*`) with `--single-transaction`, and atomically swaps live and staged databases in a single transaction on `template1`. Drops the old database only after commit. On failure, the live database is left unchanged and the safety backup path is displayed.
  - **MongoDB**: Runs `mongorestore --drop` after dry-run validation.
  - **External**: Local restore refuses external databases and directs operators to the external server's restore tools.

## Database migration (migrate-db.sh)

`migrate-db.sh` migrates data offline between any supported database backends.

```sh
./migrate-db.sh --to sqlite|postgres|mongodb|external [--window-minutes N] [--yes]
```

- **Execution flow**:
  1. Acquires the installation lock (`state/install.lock`) and validates prerequisites.
  2. Creates a private staging directory (`.env.migrate-db.*`) and records the transaction marker (`state/transaction`). Live `.env` stays untouched.
  3. Preflight check (before downtime): Verifies bundle tools, destination volume emptiness, source schema, and disk space across local `/data`, `backups`, and target volume (source size plus 20%, at least 64 MiB extra).
  4. Quiescence & downtime: Stops Caddy, API, and collab writers. Downtime begins here.
  5. Checkpoint: If the source is SQLite, folds committed WAL pages into the main file via `PRAGMA wal_checkpoint(TRUNCATE)` and verifies absence of sidecars.
  6. Target startup & quiescent backup: Starts the target backend and takes a quiescent backup of the source.
  7. Offline copy: Runs the API image's `copy-db` CLI. Skips diagnostics and records expiring within `--window-minutes`. Verifies SHA-256 data digests.
  8. Atomic activation: Swaps `.env`, updates `state/database-kind`, starts target services, verifies health, and reopens ingress.
  9. Data retention: Previous database volumes and backups are retained for operator verification and never deleted automatically.
- **Refusal and failure handling**:
  - Non-empty destination: `migrate-db: destination was not modified: refused ... use an empty destination.` Clear or drop destination before retrying.
  - Source refusal: `migrate-db: source refused ... Fix the source and retry; do not delete -wal/-shm files, which can hold committed data.`
  - Unwritten failure: `migrate-db: destination was not modified; nothing was copied.`
  - Partial copy: `migrate-db: destination may hold a partial copy; inspect and clear it before retrying.`
  - Incomplete recovery: Retains staging snapshots and prints manual recovery commands.
- **Tuning `--window-minutes`**:
  - Window defaults to 15 minutes (or `GACHIPAD_COPY_WINDOW_MINUTES`). The copy deadline is `window - 5` minutes.
  - Measured throughput: ~40 MB/s into PostgreSQL, 85–106 MB/s into SQLite for upload-heavy data (~4–7 MB/s for record-heavy data).
  - Minimum window formula: `size in MB / throughput in MB/s / 60 * 2 + 5` minutes.
- **Source stability requirement**:
  - SQLite source paths and symlinks must remain completely unchanged and writers stopped during the copy. Renaming, moving, or relinking the source path or directories causes immediate failure (`exit 1`).
- **One-time extraction for 1.0.1 upgrades**:
  - Installations updated from 1.0.1 lack `migrate-db.sh` due to the older updater's whitelist. Extract it once from the verified 1.1.0 release bundle:
    ```sh
    sha256sum -c gachipad-deploy-1.1.0.tar.gz.sha256 && \
    bundle_root="$(tar -tzf gachipad-deploy-1.1.0.tar.gz | cut -d / -f 1 | sort -u)" && \
    tar -xOf gachipad-deploy-1.1.0.tar.gz "$bundle_root/migrate-db.sh" >migrate-db.sh.new && \
    chmod 700 migrate-db.sh.new && mv migrate-db.sh.new migrate-db.sh && ./migrate-db.sh --help
    ```
- **Requirements**: Docker Compose 2.20 or newer is required.

## Admin configuration and access hardening

- **HTTPS required**: The admin console sends its bearer token with every request. Plain HTTP on non-loopback hosts triggers a persistent cleartext warning. Configure HTTPS in production.
- **Admin token and rotation**: Generate an admin token with `openssl rand -hex 32`. In production, tokens shorter than 32 characters are rejected at startup. To rotate the token: update `ADMIN_TOKEN` in `.env`, run `docker compose up -d api`, and log in again with the new token.
- **CIDR restriction (`ADMIN_ALLOW_CIDR`)**: Restrict `/api/admin/*` and the admin console to trusted network ranges. IPv4 and IPv6 are evaluated independently, so list both families if clients use both (e.g. `ADMIN_ALLOW_CIDR=10.0.0.0/8,fd00::/8`).
- **`TRUST_PROXY` requirement**: When running behind Caddy or a reverse proxy, set `TRUST_PROXY` to the proxy's exact subnet. If `TRUST_PROXY` is empty or incorrect, the proxy's address is evaluated instead of the real client IP, defeating CIDR restrictions and IP rate limits.
- **Global guess budget**: Failed admin logins share an atomic Valkey token bucket across API replicas: capacity 100, refill 100 per 10 minutes. When exhausted, token comparisons pause for 30 seconds with a `429` and `Retry-After` header. Correct tokens and addresses permitted by `ADMIN_ALLOW_CIDR` bypass the pause. Fails closed if Valkey is unavailable.

## Collab rate limit and participant permissions

- **Collab update rate limiting**: Each collaborative WebSocket connection is protected by a token bucket (burst 200 updates, sustained refill 50/s). Exceeding this closes the connection with code 4429 (`Document update rate exceeded`). Normal typing and large single pastes (counted as 1 update) do not exceed the limit.
- **Participant permissions**: Owners can grant editors permission to rename the share (`allowParticipantRename`), add/rename/delete files (`allowParticipantFiles`), or change file languages (`allowParticipantLanguage`). All three default to `false` for new and existing shares. Old records omitting these fields default safely to `false` without data migration. Unauthorized operations are refused by the server, and unsent text is kept in client tab memory for recovery.

## Diagnostics and symbolication

- **Diagnostics export**: Bounded operational diagnostics record errors, connectivity, and performance metrics (capped at 500 groups, 256 KB, 14-day retention). No telemetry is sent automatically. Users can export client diagnostics from **Settings → Diagnostics → Export**; operators can export a server bundle from **Admin Console → Diagnostics → Export** (`GET /api/admin/diagnostics/export`).
- **Release source maps**: Web source maps are stripped from the runtime container image and published as a GitHub release asset (`gachipad-web-sourcemaps-<version>.tar.gz`). To symbolicate a client export:
  ```sh
  tar xzf gachipad-web-sourcemaps-<version>.tar.gz -C /tmp/sourcemaps
  node scripts/symbolicate.mjs client-diagnostics.json /tmp/sourcemaps
  ```

## Edge (Caddy)

- `/` and unknown paths serve `index.html` (SPA fallback, `no-cache`); `/assets/*` is hashed build output (`immutable`, one year).
- `/api/*` is proxied with `flush_interval -1`, so SSE events leave immediately.
- `/collab` is proxied to every `collab` replica (`dynamic a` over the compose service name) with `lb_policy query doc`: one document normally lives on one instance. Replicas that fail `/healthz` are skipped.
- `/metrics/api` and `/metrics/collab` expose Prometheus metrics to loopback and the dedicated compose subnet only. With several collab replicas `/metrics/collab` answers from one of them; scrape the containers directly for per-instance numbers.
- HTTPS: set `SITE_ADDRESS=gachipad.local`, `PUBLIC_URL=https://gachipad.local` and copy `tls/internal.caddy.example` to `tls/local.caddy` (see `tls/README.md`).
- In internal mode, a host name in `SITE_ADDRESS` needs a `tls/*.caddy` file with a `tls ...` line (`tls internal`, or `tls <cert> <key>`). In public mode, Caddy handles automatic HTTPS directly (or accepts TLS from a configured proxy) and ignores `tls/*.caddy`. `:80` and bare IP addresses need no `tls` line.
- Clients behind Caddy: the API trusts `X-Forwarded-For` only from `TRUST_PROXY` (default: the compose network), so rate limits, PIN counters and the nearby network group use the real client address.

## More collab instances

```sh
docker compose up -d --scale collab=3      # or COLLAB_REPLICAS=3 in .env
```

Instances coordinate through Valkey (document locks, `@hocuspocus/extension-redis`). Each replica's id is its container host name.

## gachipad.local (mDNS)

gachipad includes an optional mDNS responder sidecar (`ghcr.io/kim0040/gachipad-mdns`) running in host network mode (`network_mode: host`) to answer multicast queries for `MDNS_HOSTNAME` (default `gachipad.local`). `apps/api` is not involved.

- **Host requirements**: Requires a native Linux Docker host with a local unix socket. Docker Desktop (Linux VM boundary), WSL, macOS, Windows, and remote Docker daemon endpoints cannot advertise multicast packets to the host LAN and are declined automatically.
- **Install-time behavior**: On native Linux, `install.sh` enables mDNS by default. Fresh installations prompt once on a TTY (`[Y/n]`) and default to yes non-interactively. You can pass `--mdns` to force enable, `--no-mdns` to skip, or set `GACHIPAD_MDNS=1|0` (CLI flags take precedence). Re-running `install.sh` without flags preserves your existing mDNS choice and hostname.
- **Conflict detection**: During enablement, an offline probe container checks for name conflicts on the LAN. If `gachipad.local` is already answered by another host, it tests up to 10 candidates with `-N` suffixes (`gachipad-2.local`, etc.) and saves the first free name to `MDNS_HOSTNAME`. Probe timeouts (6 s Docker / 1.4 s Node), socket errors, or candidate exhaustion warn and keep the original hostname without aborting installation. `MDNS_ALIASES` entries are also checked for conflicts (warning only, no auto-rename). Virtual bridge interfaces (`docker*`, `br-*`, `veth*`, `virbr*`) are filtered from advertisements. Set `MDNS_IP` to pin a specific interface IP if the host has several addresses.
- **Managing existing installs (`mdns.sh`)**: Manage mDNS on existing installations with `./mdns.sh enable|disable|status` instead of editing `COMPOSE_PROFILES` manually:
  ```sh
  ./mdns.sh enable|disable|status
  ```
  This only starts or stops the `mdns` container without touching `PUBLIC_URL`, `SITE_ADDRESS`, TLS, databases, or application services. `./mdns.sh enable` verifies the local image (pulling from registry only if missing), snapshots `.env`, probes for conflicts, and rolls back `.env` if startup fails or is interrupted. `./mdns.sh status` is lock-free and can run during maintenance.
- **First-update repair for <=1.1.0 installs**: Installations from version 1.1.0 or older used an updater with a fixed file list that did not extract `mdns.sh`. To restore the helper and load matching images on an offline installation after its first update, run:
  ```sh
  ./update.sh --mdns-tools /path/to/matching-bundle.tar.gz
  ```
  This requires the verified offline bundle (`gachipad-<version>-linux-<arch>.tar.gz` containing `images.tar`, not the image-less deploy tarball) matching the installed `GACHIPAD_VERSION`. It loads images and installs `mdns.sh` atomically without altering `.env` or application services.
- **Caveats**: Some Android versions and networks with multicast filtering (e.g. IGMP snooping) do not resolve `.local`; use the host's server IP address instead. For named HTTP or HTTPS sites, mDNS advertisement does not create an HTTP virtual host or TLS certificate; add a matching `SITE_ALIASES` entry and configure a certificate before relying on the name (see `tls/README.md`). Server IP addresses share this restriction.

## Offline bundle

On a machine with internet and docker:

```sh
deploy/bundle.sh [version]        # -> deploy/dist/gachipad-<version>.tar.gz and gachipad-deploy-<version>.tar.gz (+ .sha256)
BUNDLE_SOURCE=registry BUNDLE_SUFFIX=-linux-amd64 deploy/bundle.sh 1.2.3   # from the released images (release.yml)
```

Releases attach these bundles as `gachipad-<version>-linux-amd64.tar.gz` and `-linux-arm64.tar.gz`, so building one is only needed for unreleased sources. `gachipad-deploy-<version>.tar.gz` is the same without images, for `update.sh`; with `BUNDLE_SOURCE=registry` both contain `IMAGES`, the digest of each released image. The archive includes a verified content checksum manifest and holds all images (`docker save`), `docker-compose.yml` without build sections, `.env.example`, the scripts, and `LICENSE` and `THIRD_PARTY_NOTICES.md`. `images.tar` contains the unmodified official `mongo` (SSPL), `postgres` (PostgreSQL Licence), `valkey`, `caddy` and `node` base images next to the gachipad images; their licences and sources are listed in `THIRD_PARTY_NOTICES.md`. On the target host (docker + compose plugin, no internet):

```sh
sha256sum --ignore-missing -c SHA256SUMS       # download SHA256SUMS with the release bundle; a local .sha256 also works
tar xzf gachipad-<version>.tar.gz && cd gachipad-<version>       # release files are named gachipad-<version>-linux-amd64 (or -arm64)
PUBLIC_URL=http://gachipad.local ./install.sh [--db sqlite|postgres|mongodb|external]      # loads images, writes .env with new secrets, starts, waits for /healthz
./backup.sh                                     # database backup -> ./backups/gachipad-<time>.archive.gz
./restore.sh backups/gachipad-<time>.archive.gz   # stops ingress/writers, replaces DB, verifies apps, opens ingress
./migrate-db.sh --to <backend>                   # offline migration between database backends
./upgrade.sh ../gachipad-<newer>.tar.gz           # checksums, load images, stop writers, backup, readiness, automatic rollback
```

`install.sh` checks `SHA256SUMS` inside the bundle; `upgrade.sh` accepts either `<bundle>.sha256` or the released `SHA256SUMS` next to the bundle, checks the archive before extracting, then verifies the internal `SHA256SUMS` before loading images. A checksum is not a signature: it only detects a changed or damaged bundle when the value itself arrives over a trusted channel.

api and collab connect as `gachipad_app` (readWrite on database `gachipad` only). The one-shot service `mongo-users` creates that user, or resets its password and role, as root on every start, so an installation from before this user existed switches over on its next upgrade without a manual step. Upgrading from such a version runs the old `upgrade.sh`: it finishes, then prints `tmp: unbound variable` and exits 1 because of a bug in its cleanup trap (fixed since), and leaves the extracted bundle in `/tmp/tmp.*`; check `docker compose ps` and remove that directory. `deploy/verify-deploy.sh` runs the whole path (fresh install, backup, restore, refused and accepted upgrades, HTTPS, an old installation) on a docker host.

## Updates

```sh
./update.sh --check                                  # installed vs newest release; changes nothing
./update.sh [--version X.Y.Z] [--yes] [--allow-major]  # online: checksums, staged pull/digests, stop writers, backup, readiness, rollback on failure
./update.sh --bundle ../gachipad-<v>-linux-amd64.tar.gz  # offline: same transaction and rollback as upgrade.sh
sudo ./update.sh --enable-auto --at 04:00 --policy patch   # daily automatic updates (systemd timer, or cron); --disable-auto
```

`update.sh` works in an installed bundle, not in this repository. Host health checks require curl; for a private CA, set `CURL_CA_BUNDLE` to a trusted CA bundle. It parses releases with Node in the installed API image (`docker compose run --no-deps --pull never`), so host Node, Python and jq are not needed. All updates, backups and restores share one install lock (`flock`, or atomic mkdir); offline upgrades use the same transaction. Images are downloaded/loaded and checked before Caddy and the writers stop; Collab must finish its SIGTERM flush before backup. Ingress stays closed until readiness passes. If ingress activation then fails, writers stop and the verified version and current DB are retained for manual recovery, preserving any writes already accepted. Rollback restores the DB before starting the previous app, and skips DB restore if the new app never started. Any Mongo image change requires a separate supported migration and is refused before backup. Automatic scheduling requires a path containing only letters, digits, `/ . _ -`. Run as root (with sudo, or by the timer), the scripts hand the files they wrote back to the owner of the install folder when they finish (1.2.1 and later); `tls/` keeps its owner so Caddy can still read the keys. On 1.2.0 and older, if `./backup.sh` later reports Permission denied, run `sudo ./update.sh` and then `sudo ./update.sh --check` once.

It writes `state/update.json` (shown in the admin console: `./state` is mounted read-only into api) and `state/update.log`; no container gets the Docker socket. Settings: `UPDATE_REPO`, `UPDATE_CHANNEL` and `UPDATE_HEALTH_TIMEOUT` (180 s) from the environment or `.env`. The API's own release check is `UPDATE_CHECK` (on). Details, what is sent and the costs: `docs/OPERATIONS.md` §15. `deploy/update.test.sh` tests the script with fakes; `deploy/verify-update.sh` runs a real update and rollback on a docker host with a local registry.

Valkey holds join codes, presence, grants, network bans and quota counters; it is not part of the database backup. Keep its volume and do not flush it in production. See the operator security checklist in `docs/OPERATIONS.md`.

## Load test

`pnpm load -- --url http://gachipad.local --shares 100 --writers 5 --viewers 20 --duration 60` (see `scripts/load`). One machine is one client IP: raise `RATE_LIMIT_*` in `.env` for big runs.

## Notes

- `apps/api` and `apps/collab` have no build step; the images run the TypeScript sources with `tsx` (installed beside the app). `NODE_ENV=production` makes both refuse to start with weak secrets.
- Containers run as non-root where the image allows it (api, collab, Valkey, MongoDB drop privileges), with a read-only root filesystem for api and collab.
- Logs are capped at 3 x 10 MB per container.

Plain HTTP exposes document content and session/admin/PIN/edit/collab credentials to traffic observers. HTTPS setup and client CA trust instructions are in [tls/README.md](tls/README.md). Keep backups private and retain both the Mongo backup and protected Caddy CA volume.
