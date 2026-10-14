#!/usr/bin/env bash
# Setup VPS Ubuntu 24.04 untuk Indotek Budget — jalankan sebagai root, DUA TAHAP agar tidak terkunci dari SSH:
#   1) sudo bash server-setup.sh              → update OS, user deploy, Docker, ufw, fail2ban, unattended-upgrades, TZ
#      Lalu UJI di terminal LAIN: ssh deploy@<ip>  (harus berhasil dengan SSH key)
#   2) sudo bash server-setup.sh --lock-ssh   → matikan login password & root via SSH
# Aman dijalankan ulang (idempotent).
set -euo pipefail
DEPLOY_USER=${DEPLOY_USER:-deploy}
APP_DIR=${APP_DIR:-/opt/indotek}
[ "$(id -u)" = 0 ] || { echo "Jalankan sebagai root (sudo)"; exit 1; }
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || echo "PERINGATAN: diuji untuk Ubuntu 24.04 (terdeteksi ${PRETTY_NAME:-?})"
log() { echo -e "\n\033[1;34m== $*\033[0m"; }

lock_ssh() {
  local keys="/home/$DEPLOY_USER/.ssh/authorized_keys"
  [ -s "$keys" ] || { echo "BATAL: $keys kosong — tambahkan SSH public key dulu"; exit 1; }
  log "kunci SSH: key-only, tanpa root"
  cat > /etc/ssh/sshd_config.d/99-indotek.conf <<CONF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AllowUsers $DEPLOY_USER
MaxAuthTries 4
LoginGraceTime 30
CONF
  sshd -t
  systemctl reload ssh
  echo "SSH dikunci. Login hanya: ssh $DEPLOY_USER@<ip> dengan SSH key."
}
if [ "${1:-}" = "--lock-ssh" ]; then lock_ssh; exit 0; fi

log "update OS"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get -o Dpkg::Options::=--force-confold full-upgrade -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades apt-listchanges git jq htop

log "timezone Asia/Jakarta"
timedatectl set-timezone Asia/Jakarta

log "user $DEPLOY_USER"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
if [ ! -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ] && [ -s /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
  echo "authorized_keys root disalin ke $DEPLOY_USER"
fi
[ -f "/home/$DEPLOY_USER/.ssh/authorized_keys" ] && chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys" && chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

log "Docker Engine + compose plugin (repo resmi Docker)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" }, "live-restore": true }
JSON
systemctl enable --now docker
systemctl restart docker
usermod -aG docker "$DEPLOY_USER"

log "firewall ufw: 22, 80, 443"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (redirect + ACME)'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 443/udp comment 'HTTP/3'
ufw --force enable

log "fail2ban (sshd)"
cat > /etc/fail2ban/jail.d/indotek.local <<'CONF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "unattended-upgrades (security), reboot otomatis 04:00 WIB bila diperlukan"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/52indotek-unattended <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF
systemctl enable --now unattended-upgrades

log "swap 2 GB (cadangan memori Chromium/PDF)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "folder aplikasi $APP_DIR"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

log "SELESAI tahap 1"
cat <<MSG
Berikutnya:
  1. Di terminal LAIN (jangan tutup sesi ini): ssh $DEPLOY_USER@<ip-server>   → harus berhasil
  2. Bila berhasil: sudo bash $0 --lock-ssh
  3. Lanjut RUNBOOK §2 (clone repo / salin file ke $APP_DIR sebagai $DEPLOY_USER)
MSG
