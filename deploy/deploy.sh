#!/bin/sh
# Выкладка LeadFlow с локальной машины на сервер.
# Берёт файлы, которые отслеживает git (с незакоммиченными правками), собирает на сервере
# и проверяет /api/health. Если проверка не прошла — возвращает прежние образы и исходники.
#
#   sh deploy/deploy.sh
#
# Переменные: LEADFLOW_HOST (root@31.192.111.33), LEADFLOW_PORT (2222).
set -eu

HOST="${LEADFLOW_HOST:-root@31.192.111.33}"
PORT="${LEADFLOW_PORT:-2222}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$(mktemp -d)/leadflow-src.tgz"

cd "$ROOT"
echo "→ Упаковываю исходники"
git ls-files -z --cached --others --exclude-standard | COPYFILE_DISABLE=1 tar --no-xattrs -czf "$ARCHIVE" --null -T -

echo "→ Копирую на сервер"
scp -q -P "$PORT" "$ARCHIVE" "$HOST:/tmp/leadflow-src.tgz"

echo "→ Собираю и запускаю"
ssh -p "$PORT" "$HOST" STAMP="$STAMP" sh -s <<'REMOTE'
set -eu
cd /opt
mkdir -p /root/leadflow-releases
tar --exclude=leadflow/node_modules --exclude=leadflow/.next -czf "/root/leadflow-releases/src-$STAMP.tgz" leadflow
ls -1t /root/leadflow-releases/src-*.tgz | tail -n +6 | xargs -r rm -f
docker tag leadflow-app:latest leadflow-app:prev 2>/dev/null || true
docker tag leadflow-worker:latest leadflow-worker:prev 2>/dev/null || true

if ! sh /opt/leadflow/deploy/remote-up.sh > /tmp/leadflow-deploy.log 2>&1; then
  tail -40 /tmp/leadflow-deploy.log
  echo "✗ Сборка упала. Работает прежняя версия (контейнеры не пересоздавались)."
  tar -xzf "/root/leadflow-releases/src-$STAMP.tgz" -C /opt
  exit 1
fi

ok=0
for i in $(seq 1 30); do
  if curl -fsS -m 5 http://127.0.0.1:3100/api/health | grep -q '"status":"ok"'; then ok=1; break; fi
  sleep 3
done

if [ "$ok" != 1 ]; then
  echo "✗ /api/health не отвечает. Откатываю."
  docker compose -f /opt/leadflow/docker-compose.yml logs --tail=40 app worker || true
  tar -xzf "/root/leadflow-releases/src-$STAMP.tgz" -C /opt
  docker tag leadflow-app:prev leadflow-app:latest
  docker tag leadflow-worker:prev leadflow-worker:latest
  cd /opt/leadflow && docker compose up -d --no-build app worker
  exit 1
fi
docker image prune -f >/dev/null 2>&1 || true
echo "✓ Новая версия работает"
REMOTE

echo "→ Проверка снаружи"
curl -fsS -m 15 https://leadflow.siteaccess.ru/api/health && echo
