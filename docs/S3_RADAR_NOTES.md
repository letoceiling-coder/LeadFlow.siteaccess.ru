# S3 «Радар» — заметки для слияния (ветка claude/s3-radar-5a088a)

Общие файлы (только добавление):
- prisma/schema.prisma — модели Radar* в конце файла, БЕЗ relation в Tenant (только tenantId). Миграция 20261127030000_radar.
- src/lib/jobs/process.ts — импорт runRadarPoll, метка "radar.poll", ветка перед `else throw`.
- src/lib/server/hunt-routes.ts — импорт radarRoutes + строка `if (section === "radar") return radarRoutes(...)` в начале huntRoutes.
- src/components/hunt/shell.tsx — пункт NAV «Радар» (/hunt/radar, иконка Radar); нижняя панель: grid по NAV.length (style), вместо grid-cols-6 — переживёт пункты других сессий.
Новое: src/app/api/radar-bot/[projectId]/route.ts — публичный webhook бота заказчика (секрет в заголовке), мимо router.ts.
Для прода нужен APP_URL=https://leadflow.siteaccess.ru (webhook).
Проверка на реальных чатах НЕ выполнена: SSH на прод из S3 заблокирован фильтром разрешений. Скрипт только на чтение: scripts/radar-check.ts.

## Проверка на проде 27.11 (только чтение, записей в базу 0)
Три прогона scripts/radar-check.ts в контейнере app (код во /tmp/rc, после — удалён), модель z-ai/glm-5.3-flash.
- Чаты аренды складов и коммерческой недвижимости: @rentmarketmsk, @rentmarketspb, @sklada_arenda, @Ofisy_Moskva, @skladarena, @skladarenda, @mskdengi, @Rabota_Moskva_Vakhta_sklad_group.
- Чаты селлеров и фулфилмента: @fullfilment_topchat, @fulfillmentnumberone, @wildberries_service, @wildberries_ozon_postavshchiki, @ozonhelpchat, @ozon_chat.
- Прочитано ~600 сообщений без вступления; resolve/search/history работают для групп.
- Живых запросов арендаторов в последних ~50 сообщениях этих чатов нет: там предложения владельцев и реклама. Модель разметила все 22 разобранных как ad/offer/other с баллом 0–10 — ложных находок 0; город/район берёт только из текста (СПб, Парнас).
- По итогам: фразы ключевых слов теперь должны стоять рядом (окно 6 слов) — длинные промо-посты перестали проходить (56 → 37 совпадений на тех же чатах).
- Положительный путь (настоящий запрос → находка) на живых данных не встретился; покрыт тестами.
- Шаблон «Ищете склад? Мы предлагаем…» проходит фильтр («ищете» = «ищу»), отсекает модель. Советуем минус-слова: «предлагаем», «сдаём», «сдам», «в наличии».
