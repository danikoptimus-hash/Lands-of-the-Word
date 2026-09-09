#!/usr/bin/env bash
# Первичная настройка сервера Lands of the Word (Ubuntu 24.04, запуск от root).
# Что делает: обновления безопасности, swap, пользователь deploy, SSH только по ключу,
# fail2ban, клон репозитория в /opt/lotw, запуск Caddy с HTTPS и страницей-заглушкой.
# Запуск:  bash bootstrap.sh landsoftheword.com
set -euo pipefail

DOMAIN="${1:-}"
REPO_URL="https://github.com/danikoptimus-hash/Lands-of-the-Word.git"
BRANCH="claude/lands-word-city-conquest-6xtei9"
APP_DIR="/opt/lotw"

if [[ -z "$DOMAIN" ]]; then echo "Использование: bash bootstrap.sh <домен>"; exit 1; fi
if [[ "$(id -u)" -ne 0 ]]; then echo "Запускать от root"; exit 1; fi

echo "==> 1/8 Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git curl fail2ban unattended-upgrades dnsutils
if ! command -v docker >/dev/null; then apt-get install -y -q docker.io docker-compose-v2; fi
systemctl enable --now docker

echo "==> 2/8 Автообновления безопасности"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> 3/8 Swap 2 GB (страховка для 2 GB RAM)"
if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> 4/8 Пользователь deploy"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
  usermod -aG docker deploy
  mkdir -p /home/deploy/.ssh
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
fi

echo "==> 5/8 SSH: только по ключу"
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/90-lotw.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSH
systemctl restart ssh

echo "==> 6/8 fail2ban"
systemctl enable --now fail2ban

echo "==> 7/8 Репозиторий в $APP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi
chown -R deploy:deploy "$APP_DIR"

echo "==> 8/8 Caddy + страница-заглушка (HTTPS)"
SERVER_IP="$(curl -s -4 https://ifconfig.me || true)"
DNS_IP="$(dig +short A "$DOMAIN" | tail -n1 || true)"
if [[ -n "$SERVER_IP" && "$DNS_IP" != "$SERVER_IP" ]]; then
  echo "ВНИМАНИЕ: $DOMAIN указывает на '$DNS_IP', а сервер — '$SERVER_IP'. Сертификат не выдастся, пока DNS не обновится. Запусти скрипт ещё раз позже."
fi
docker rm -f test >/dev/null 2>&1 || true
ENV_FILE="$APP_DIR/deploy/.env"
touch "$ENV_FILE"
grep -q '^DOMAIN=' "$ENV_FILE" || echo "DOMAIN=$DOMAIN" >> "$ENV_FILE"
grep -q '^POSTGRES_PASSWORD=' "$ENV_FILE" || echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> "$ENV_FILE"
grep -q '^SESSION_SECRET=' "$ENV_FILE" || echo "SESSION_SECRET=$(openssl rand -hex 32)" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
mkdir -p /opt/lotw-backups
chown -R deploy:deploy "$APP_DIR" /opt/lotw-backups
# База и Caddy поднимаются сразу; приложение приедет первым автодеплоем из GitHub Actions.
(cd "$APP_DIR/deploy" && docker compose up -d db caddy)
echo
echo "Готово. Сертификат выпустится в течение 1–2 минут; приложение появится после первого автодеплоя (см. deploy/README.md)."
echo "Логи Caddy: docker logs -f lotw-caddy"
