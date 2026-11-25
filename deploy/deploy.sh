#!/bin/sh
# Выкладка LeadFlow с локальной машины на сервер.
# Берёт файлы, которые отслеживает git (с незакоммиченными правками), собирает на сервере
# и проверяет /api/health. Если проверка не прошла — возвращает прежние образы и исходники.
#
#   sh deploy/deploy.sh
#
# Переменные: LEADFLOW_HOST (root@31.192.111.33), LEADFLOW_PORT (2222),
#             LEADFLOW_FORCE=1 — выложить, даже если на сервере код, которого нет в вашей истории git.
#
# Выкладывают несколько человек. Выкладка заменяет src/public/prisma/tests целиком, поэтому сначала
# проверяем: код на сервере должен совпадать с одним из коммитов вашей истории (то есть чужая выкладка
# уже влита к вам). Иначе — стоп: заберите изменения с сервера и слейте их, потом выкладывайте.
set -eu

HOST="${LEADFLOW_HOST:-root@31.192.111.33}"
PORT="${LEADFLOW_PORT:-2222}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
ARCHIVE="$TMP/leadflow-src.tgz"

cd "$ROOT"
echo "→ Проверяю, что на сервере нет чужих изменений"
# Список «git-хеш путь» для кода на сервере (без .env, данных и сборки).
ssh -p "$PORT" "$HOST" 'cd /opt/leadflow && find . -type f -not -path "./node_modules/*" -not -path "./.next/*" -not -path "./data/*" -not -name .env -not -name tsconfig.tsbuildinfo -not -name "=" | sed "s#^\./##" | while IFS= read -r f; do printf "%s %s\n" "$(git hash-object "$f")" "$f"; done | LC_ALL=C sort' > "$TMP/server.list"
match=""
for c in $(git rev-list --max-count=500 HEAD); do
  git -c core.quotePath=false ls-tree -r --format='%(objectname) %(path)' "$c" | LC_ALL=C sort > "$TMP/commit.list"
  if cmp -s "$TMP/server.list" "$TMP/commit.list"; then match="$c"; break; fi
done
if [ -n "$match" ]; then
  echo "  сервер = коммит $(git log -1 --format='%h %s' "$match")"
elif [ "${LEADFLOW_FORCE:-}" = "1" ]; then
  echo "  ⚠ кода с сервера нет в вашей истории — выкладываю из-за LEADFLOW_FORCE=1"
else
  git -c core.quotePath=false ls-tree -r --format='%(objectname) %(path)' HEAD | LC_ALL=C sort > "$TMP/head.list"
  echo "✗ На сервере код, которого нет в вашей истории git (кто-то выложил свою версию)."
  echo "  Отличается от вашего HEAD:"
  comm -3 "$TMP/head.list" "$TMP/server.list" | awk '{print $NF}' | LC_ALL=C sort -u | sed 's/^/    /'
  echo "  Заберите серверную версию и слейте её с вашей (см. deploy/sync-from-server.sh), затем повторите."
  exit 1
fi

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

# Архив только добавляет файлы. Удалённые в git страницы остались бы на сервере и сломали сборку,
# поэтому папки с кодом очищаются целиком (копия выше). .env, данные и volume не трогаются.
CODE_DIRS="/opt/leadflow/src /opt/leadflow/public /opt/leadflow/prisma /opt/leadflow/tests"
restore() { rm -rf $CODE_DIRS; tar -xzf "/root/leadflow-releases/src-$STAMP.tgz" -C /opt; }
rm -rf $CODE_DIRS

if ! sh /opt/leadflow/deploy/remote-up.sh > /tmp/leadflow-deploy.log 2>&1; then
  tail -40 /tmp/leadflow-deploy.log
  echo "✗ Сборка упала. Работает прежняя версия (контейнеры не пересоздавались)."
  restore
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
  restore
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

# Запоминаем, из какого коммита выложено: это база для слияния в deploy/sync-from-server.sh.
dirty=""; git diff --quiet HEAD 2>/dev/null || dirty=" (+незакоммиченные правки)"
ssh -p "$PORT" "$HOST" "echo '$(git rev-parse HEAD)$dirty' > /root/leadflow-releases/last-commit"
