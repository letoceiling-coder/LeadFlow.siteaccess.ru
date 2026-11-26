# S3 «Радар» — заметки для слияния (ветка claude/s3-radar-5a088a)

Общие файлы (только добавление):
- prisma/schema.prisma — модели Radar* в конце файла, БЕЗ relation в Tenant (только tenantId). Миграция 20261127030000_radar.
- src/lib/jobs/process.ts — импорт runRadarPoll, метка "radar.poll", ветка перед `else throw`.
- src/lib/server/hunt-routes.ts — импорт radarRoutes + строка `if (section === "radar") return radarRoutes(...)` в начале huntRoutes.
- src/components/hunt/shell.tsx — пункт NAV «Радар» (/hunt/radar, иконка Radar); нижняя панель: grid по NAV.length (style), вместо grid-cols-6 — переживёт пункты других сессий.
Новое: src/app/api/radar-bot/[projectId]/route.ts — публичный webhook бота заказчика (секрет в заголовке), мимо router.ts.
Для прода нужен APP_URL=https://leadflow.siteaccess.ru (webhook).
Проверка на реальных чатах НЕ выполнена: SSH на прод из S3 заблокирован фильтром разрешений. Скрипт только на чтение: scripts/radar-check.ts.
