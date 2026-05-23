#!/usr/bin/env bash
# Aramis — one-shot Linux installer.
#
# Goals:
#   1. Work on a clean VPS or a panel-hosted server (cPanel, DirectAdmin,
#      aaPanel, Plesk) without colliding with the panel's own ports/services.
#   2. Pick a free TCP port automatically (default search starts at 5174 and
#      skips all known panel ports).
#   3. Install Node 20+ from NodeSource if it isn't already present.
#   4. Clone (or fast-update) /opt/aramis, build the web bundle, and create a
#      dedicated unprivileged `aramis` user.
#   5. Drop a systemd unit (or an OpenRC fallback) and start it.
#   6. NEVER touch httpd/nginx/apache or any panel config. The user wires the
#      reverse proxy through their panel.
#
# Run as root (sudo). Idempotent — re-running upgrades to the latest tag.
#
#   curl -fsSL https://raw.githubusercontent.com/ARaminco/aramis/main/scripts/install-linux.sh | sudo bash
#
# Env overrides (optional):
#   ARAMIS_DIR=/opt/aramis            installation prefix
#   ARAMIS_PORT=5174                  fixed port (skip auto-detection)
#   ARAMIS_USER=aramis                service user
#   ARAMIS_REPO=https://github.com/ARaminco/aramis.git
#   ARAMIS_BRANCH=main
#   ARAMIS_NODE_MAJOR=20              minimum Node major version
#   ARAMIS_NO_SERVICE=1               skip systemd unit (build & install only)

set -euo pipefail

ARAMIS_DIR="${ARAMIS_DIR:-/opt/aramis}"
ARAMIS_USER="${ARAMIS_USER:-aramis}"
ARAMIS_REPO="${ARAMIS_REPO:-https://github.com/ARaminco/aramis.git}"
ARAMIS_BRANCH="${ARAMIS_BRANCH:-main}"
ARAMIS_NODE_MAJOR="${ARAMIS_NODE_MAJOR:-20}"

# Ports that panels reserve and we MUST NOT bind to.
PANEL_PORTS=(
  80 443                       # http(s)
  21 22 25 110 143 443 465 587 993 995  # mail / ftp / ssh — common
  2082 2083 2086 2087 2095 2096 2222    # cPanel / WHM / Webmail
  2052 2053 2080 2081 2086 2087 2095 2096  # cPanel variants
  7080 7081                    # LiteSpeed admin
  8080 8081 8083 8090          # common alt-http
  8443                         # Plesk
  8880                         # DirectAdmin
  9090                         # cockpit
  10000                        # Webmin
  21099 41022                  # DirectAdmin alt
  35900                        # aaPanel default admin (varies)
  88                           # Kubernetes / panel webhooks
)

# --- pretty helpers --------------------------------------------------------
B="\033[1m"; D="\033[2m"; G="\033[32m"; Y="\033[33m"; R="\033[31m"; C="\033[36m"; N="\033[0m"
say()  { printf "${C}[aramis]${N} %s\n" "$*"; }
ok()   { printf "${G}✓${N} %s\n" "$*"; }
warn() { printf "${Y}!${N} %s\n" "$*" >&2; }
die()  { printf "${R}✗${N} %s\n" "$*" >&2; exit 1; }

need_root() {
  if [[ $EUID -ne 0 ]]; then
    die "this installer must be run as root (sudo bash install-linux.sh)"
  fi
}

# --- distro detection ------------------------------------------------------
detect_distro() {
  if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    DISTRO_ID="${ID:-unknown}"
    DISTRO_LIKE="${ID_LIKE:-}"
    DISTRO_VER="${VERSION_ID:-}"
  else
    DISTRO_ID="unknown"; DISTRO_LIKE=""; DISTRO_VER=""
  fi
  case "$DISTRO_ID:$DISTRO_LIKE" in
    debian:*|ubuntu:*|*:*debian*) PKG="apt" ;;
    rhel:*|centos:*|almalinux:*|rocky:*|*:*rhel*) PKG="dnf" ;;
    fedora:*) PKG="dnf" ;;
    arch:*|*:*arch*) PKG="pacman" ;;
    alpine:*) PKG="apk" ;;
    *) PKG="" ;;
  esac
}

# --- panel detection (informational + port avoidance) ----------------------
detect_panels() {
  PANELS=()
  [[ -x /usr/local/cpanel/bin/whmapi1 ]] && PANELS+=("cPanel")
  [[ -d /usr/local/directadmin ]] && PANELS+=("DirectAdmin")
  [[ -d /www/server/panel ]] && PANELS+=("aaPanel")
  [[ -d /usr/local/psa ]] && PANELS+=("Plesk")
  [[ -d /usr/local/CyberPanel || -f /usr/local/lsws/bin/lswsctrl ]] && PANELS+=("CyberPanel/LiteSpeed")
  if (( ${#PANELS[@]} > 0 )); then
    say "detected control panel(s): ${PANELS[*]}"
    say "Aramis will pick a non-conflicting port and will NOT touch your panel."
  else
    say "no control panel detected — clean VPS install."
  fi
}

# --- port picker -----------------------------------------------------------
port_in_use() {
  local p=$1
  # Try ss first (modern), fall back to /proc/net/tcp.
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}$" && return 0
  fi
  # Hex port lookup in /proc/net/tcp{,6}: format is local_address:hexport
  local hex
  hex=$(printf '%04X' "$p")
  if grep -qE "^\s*[0-9]+: [0-9A-F]+:${hex} " /proc/net/tcp /proc/net/tcp6 2>/dev/null; then
    return 0
  fi
  return 1
}

is_panel_port() {
  local p=$1
  local q
  for q in "${PANEL_PORTS[@]}"; do [[ "$q" == "$p" ]] && return 0; done
  return 1
}

pick_port() {
  if [[ -n "${ARAMIS_PORT:-}" ]]; then
    if is_panel_port "$ARAMIS_PORT"; then
      warn "ARAMIS_PORT=$ARAMIS_PORT is on the panel reserved list — using it anyway as you asked."
    fi
    if port_in_use "$ARAMIS_PORT"; then
      die "ARAMIS_PORT=$ARAMIS_PORT is already in use."
    fi
    return
  fi
  # Search a comfortable, non-privileged, non-panel range.
  local candidates=(5174 5175 5180 5188 5200 5210 5220 5230 5300 5400 5555 6174 7174 8174 9174 17174)
  local p
  for p in "${candidates[@]}"; do
    is_panel_port "$p" && continue
    port_in_use "$p" && continue
    ARAMIS_PORT="$p"
    return
  done
  # Last-ditch scan
  for p in $(seq 5500 5999); do
    is_panel_port "$p" && continue
    port_in_use "$p" && continue
    ARAMIS_PORT="$p"
    return
  done
  die "could not find a free port between 5174 and 5999."
}

# --- dependency install ----------------------------------------------------
install_base_deps() {
  case "$PKG" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y -qq --no-install-recommends \
        ca-certificates curl gnupg git build-essential python3 >/dev/null
      ;;
    dnf)
      dnf -y install -q ca-certificates curl gnupg2 git gcc-c++ make python3 >/dev/null
      ;;
    pacman)
      pacman -Sy --noconfirm --needed base-devel git curl python ca-certificates >/dev/null
      ;;
    apk)
      apk add --no-cache ca-certificates curl gnupg git build-base python3 >/dev/null
      ;;
    *)
      warn "unknown package manager — make sure git, curl, gcc, make, python3 are present."
      ;;
  esac
}

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0
}

install_node() {
  local cur
  cur=$(node_major)
  if (( cur >= ARAMIS_NODE_MAJOR )); then
    ok "Node.js $cur present (>= $ARAMIS_NODE_MAJOR)."
    return
  fi
  say "installing Node.js $ARAMIS_NODE_MAJOR via NodeSource…"
  case "$PKG" in
    apt)
      curl -fsSL "https://deb.nodesource.com/setup_${ARAMIS_NODE_MAJOR}.x" | bash - >/dev/null
      apt-get install -y -qq nodejs >/dev/null
      ;;
    dnf)
      curl -fsSL "https://rpm.nodesource.com/setup_${ARAMIS_NODE_MAJOR}.x" | bash - >/dev/null
      dnf -y install -q nodejs >/dev/null
      ;;
    pacman)
      pacman -Sy --noconfirm --needed nodejs npm >/dev/null
      ;;
    apk)
      apk add --no-cache nodejs npm >/dev/null
      ;;
    *)
      die "no supported package manager; install Node.js $ARAMIS_NODE_MAJOR manually and re-run."
      ;;
  esac
  ok "Node.js $(node -v) installed."
}

ensure_user() {
  if id -u "$ARAMIS_USER" >/dev/null 2>&1; then
    ok "user $ARAMIS_USER exists."
    return
  fi
  say "creating system user $ARAMIS_USER…"
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "/var/lib/$ARAMIS_USER" --shell /usr/sbin/nologin "$ARAMIS_USER" 2>/dev/null \
      || useradd --system --shell /usr/sbin/nologin "$ARAMIS_USER"
  else
    adduser -S -D -H "$ARAMIS_USER" || die "could not create user $ARAMIS_USER"
  fi
  ok "user $ARAMIS_USER ready."
}

# --- code checkout & build -------------------------------------------------
checkout_code() {
  if [[ -d "$ARAMIS_DIR/.git" ]]; then
    say "updating existing clone in $ARAMIS_DIR…"
    git -C "$ARAMIS_DIR" remote set-url origin "$ARAMIS_REPO"
    git -C "$ARAMIS_DIR" fetch --depth=1 origin "$ARAMIS_BRANCH"
    git -C "$ARAMIS_DIR" reset --hard "origin/$ARAMIS_BRANCH"
  else
    say "cloning $ARAMIS_REPO into $ARAMIS_DIR…"
    mkdir -p "$(dirname "$ARAMIS_DIR")"
    git clone --depth=1 --branch "$ARAMIS_BRANCH" "$ARAMIS_REPO" "$ARAMIS_DIR"
  fi
}

build_app() {
  say "installing npm dependencies (root + server + web)…"
  (cd "$ARAMIS_DIR" && npm install --no-audit --no-fund --silent)
  (cd "$ARAMIS_DIR/server" && npm install --no-audit --no-fund --silent)
  (cd "$ARAMIS_DIR/web" && npm install --no-audit --no-fund --silent)
  say "building the web bundle…"
  (cd "$ARAMIS_DIR" && npm run build:web --silent)
  ok "build completed."
}

write_env() {
  local env_file="$ARAMIS_DIR/server/.env"
  if [[ -f "$env_file" ]]; then
    say ".env exists — keeping it. (delete it manually to regenerate.)"
    return
  fi
  local secret
  secret=$(openssl rand -hex 48 2>/dev/null || head -c 64 /dev/urandom | xxd -p | tr -d '\n')
  cat > "$env_file" <<EOF
# Generated by install-linux.sh on $(date -Iseconds)
PORT=$ARAMIS_PORT
JWT_SECRET=$secret
NODE_ENV=production
# CORS_ORIGIN=https://aramis.your-domain.com
# DB_PATH=/var/lib/aramis/aramis.db
EOF
  chmod 600 "$env_file"
  ok "wrote $env_file with a fresh 48-byte JWT secret."
}

fix_ownership() {
  chown -R "$ARAMIS_USER:$ARAMIS_USER" "$ARAMIS_DIR"
}

# --- service unit ----------------------------------------------------------
install_systemd_unit() {
  if [[ "${ARAMIS_NO_SERVICE:-0}" == "1" ]]; then
    say "ARAMIS_NO_SERVICE=1 — skipping systemd unit."
    return
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemd not detected. Start manually with: sudo -u $ARAMIS_USER PORT=$ARAMIS_PORT node $ARAMIS_DIR/server/src/index.js"
    return
  fi
  local node_bin
  node_bin=$(command -v node)
  cat > /etc/systemd/system/aramis.service <<EOF
[Unit]
Description=Aramis AI Terminal Agent
After=network.target

[Service]
Type=simple
User=$ARAMIS_USER
Group=$ARAMIS_USER
WorkingDirectory=$ARAMIS_DIR
EnvironmentFile=$ARAMIS_DIR/server/.env
ExecStart=$node_bin $ARAMIS_DIR/server/src/index.js
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

# Light hardening — does NOT touch panel/web-root paths.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes
ReadWritePaths=$ARAMIS_DIR/server

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now aramis.service
  ok "aramis.service enabled and started."
}

# --- entry point -----------------------------------------------------------
need_root
detect_distro
detect_panels
install_base_deps
install_node
ensure_user
pick_port
checkout_code
build_app
write_env
fix_ownership
install_systemd_unit

cat <<EOF

${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}
${B}Aramis installed.${N}

  Listening on : http://127.0.0.1:${ARAMIS_PORT}
  Install dir  : $ARAMIS_DIR
  Service user : $ARAMIS_USER
  Service      : systemctl status aramis

${B}Next steps:${N}
  • Add a reverse proxy in your panel (cPanel ProxyPass, DirectAdmin Custom HTTPD,
    or aaPanel "Proxy Project") pointing your subdomain to 127.0.0.1:${ARAMIS_PORT}.
  • Open the UI, create the admin password, and configure your AI provider.
  • To upgrade later: re-run this same install command. It does a fast-forward
    git pull + rebuild and restarts the service.

${D}Logs:${N}  journalctl -u aramis -f
${D}Stop:${N}  systemctl stop aramis
${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}

EOF
