#!/bin/sh
# Забрать код, который сейчас на сервере (например, выложенный другим человеком), и слить с вашей веткой.
#
#   sh deploy/sync-from-server.sh
#
# Серверная версия коммитится в ветку server-snapshot-<время> от коммита последней выкладки
# (/root/leadflow-releases/last-commit) и сливается в текущую ветку обычным git merge —
# правки обеих сторон сохраняются, пересечения git покажет как конфликты.
set -eu

HOST="${LEADFLOW_HOST:-root@31.192.111.33}"
PORT="${LEADFLOW_PORT:-2222}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "✗ Есть незакоммиченные правки. Закоммитьте или уберите их и повторите."; exit 1
fi

base="${1:-$(ssh -p "$PORT" "$HOST" 'cut -d" " -f1 /root/leadflow-releases/last-commit 2>/dev/null' || true)}"
if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "✗ Коммит последней выкладки (${base:-неизвестен}) не найден в вашей истории."
  echo "  Укажите базу вручную: sh deploy/sync-from-server.sh <коммит, от которого начиналась серверная версия>"
  exit 1
fi

branch="server-snapshot-$(date +%Y%m%d-%H%M%S)"
WT="$(mktemp -d)/wt"
echo "→ Снимок сервера в ветку $branch (от $(git log -1 --format='%h %s' "$base"))"
git worktree add -q "$WT" "$base" -b "$branch"
( cd "$WT"
  git ls-files -z | xargs -0 rm -f
  ssh -p "$PORT" "$HOST" 'cd /opt/leadflow && tar --exclude=./node_modules --exclude=./.next --exclude=./data --exclude=./.env --exclude=./tsconfig.tsbuildinfo --exclude="./=" -czf - .' | tar -xzf -
  git add -A
  if git diff --cached --quiet; then echo "  сервер не отличается от базы"; else git commit -qm "Server snapshot /opt/leadflow ($(date '+%Y-%m-%d %H:%M'))"; fi )
git worktree remove --force "$WT"

echo "→ Сливаю в $(git branch --show-current)"
git merge --no-ff "$branch" -m "Merge server changes ($branch)" || {
  echo "✗ Конфликты — разрешите их, затем git commit. Список: git diff --name-only --diff-filter=U"; exit 1; }
echo "✓ Готово. Проверьте git log и выкладывайте: sh deploy/deploy.sh"
