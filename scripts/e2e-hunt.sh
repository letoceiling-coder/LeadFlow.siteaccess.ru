#!/bin/bash
# Критические сценарии охоты против ЛОКАЛЬНОГО LeadFlow (не запускать на рабочей базе: создаёт и чистит тестовые записи source='e2e').
# Нужно: запущенные `npx next dev` и обработчик задач, вход владельца в cookie-файле, psql до той же базы.
#   E2E_BASE=http://localhost:3333 E2E_COOKIES=/путь/cookies.txt E2E_PSQL="postgresql://postgres@127.0.0.1:55432/leadflow" bash scripts/e2e-hunt.sh
set -u
S=$(mktemp -d)
BASE=${E2E_BASE:-http://localhost:3333}
B=$BASE/api
H=(-sS -b "${E2E_COOKIES:?укажите E2E_COOKIES}" -H 'Content-Type: application/json' -H "Origin: $BASE")
Q(){ psql "${E2E_PSQL:?укажите E2E_PSQL}" -tAc "$1"; }
case "$E2E_PSQL" in *127.0.0.1*|*localhost*) ;; *) echo "Только локальная база"; exit 1;; esac
J(){ python3 -I -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
pass=0; fail=0
check(){ if [ "$2" = "$3" ]; then echo "  ПРОЙДЕН  $1"; pass=$((pass+1)); else echo "  ПРОВАЛЕН $1 — ждали «$3», получили «$2»"; fail=$((fail+1)); fi; }
oid(){ Q "select h.id from \"Outreach\" h join \"Organization\" o on o.id=h.\"organizationId\" where o.name='$1'"; }
waitq(){ for i in $(seq 1 40); do [ "$(Q "select count(*) from \"Outreach\" where \"cardStatus\"='queued'")" = "0" ] && return; sleep 1; done; }

cd "$(dirname "$0")/.."
Q "delete from \"Project\" where \"outreachId\" in (select h.id from \"Outreach\" h join \"Organization\" o on o.id=h.\"organizationId\" where o.source='e2e')" >/dev/null
Q "delete from \"Outreach\" where \"organizationId\" in (select id from \"Organization\" where source='e2e')" >/dev/null
Q "delete from \"SuppressionEntry\" where value like '%e2e%' or value like '+7999000100%' or value in (select 'org:'||id from \"Organization\" where source='e2e')" >/dev/null
Q "delete from \"OptOut\" where \"organizationId\" in (select id from \"Organization\" where source='e2e')" >/dev/null
Q "delete from \"Activity\" where \"organizationId\" in (select id from \"Organization\" where source='e2e')" >/dev/null
Q "update \"Lead\" set \"stageId\"=(select id from \"PipelineStage\" where key='new' limit 1) where \"organizationId\" in (select id from \"Organization\" where source='e2e')" >/dev/null
IDS=$(DATABASE_URL="$E2E_PSQL" npx tsx scripts/e2e-hunt-seed.ts)
curl "${H[@]}" -d "{\"organizationIds\":$IDS,\"confirmLarge\":true}" $B/hunt/qualify >/dev/null; waitq

echo "1. Скоринг без AI на неполных данных"
check "с отзывами и без сайта → в ленте" "$(Q "select priority||h.\"cardStatus\" from \"Outreach\" h join \"Organization\" o on o.id=h.\"organizationId\" where o.name='E2E Бургеры Ready'")" "Aready"
check "без отзывов, соцсеть вместо сайта → на проверку (C)" "$(Q "select priority||h.\"cardStatus\" from \"Outreach\" h join \"Organization\" o on o.id=h.\"organizationId\" where o.name='E2E Шаурма Check'")" "Cno_fact"
check "живой сайт → не в ленте" "$(Q "select h.\"cardStatus\" from \"Outreach\" h join \"Organization\" o on o.id=h.\"organizationId\" where o.name='E2E Ресторан с сайтом'")" "no_fact"
REV=$(curl "${H[@]}" $B/hunt/today | J "len([i for i in d['data']['review'] if i['organization']['name'].startswith('E2E')])")
check "очередь «Проверить»: 2 без денег + ресторан с сайтом без хаоса" "$REV" "3"

echo "2. AI недоступен"
check "лента честно говорит, что AI выключен" "$(curl "${H[@]}" $B/hunt/today | J "d['data']['ai']['ready']")" "False"

echo "3. Ручной факт → готовая карточка → написать → отправил → следующая"
SH=$(oid "E2E Шаурма Check")
check "approve до факта запрещён" "$(curl "${H[@]}" -d '{"action":"approve"}' $B/hunt/$SH/decide | J "d['error']['code']")" "card_not_ready"
check "факт «2+ филиала» делает карточку готовой" "$(curl "${H[@]}" -d '{"kind":"money","text":"2+ филиала"}' $B/hunt/$SH/fact | J "str(d['data']['ready'])+d['data']['priority']")" "TrueA"
check "approve после факта" "$(curl "${H[@]}" -d '{"action":"approve"}' $B/hunt/$SH/decide | J "d['ok']")" "True"
check "источник факта — «вы проверили»" "$(Q "select card->'money'->-1->>'source' from \"Outreach\" where id='$SH'")" "manual"
BU=$(oid "E2E Бургеры Ready")
curl "${H[@]}" -d '{"action":"approve"}' $B/hunt/$BU/decide >/dev/null
NEXT=$(curl "${H[@]}" "$B/hunt/next?after=$SH" | J "d['data']['id'] if d['data'] else ''")
check "после отправки предлагается следующая взятая карточка" "$NEXT" "$BU"
check "отправил" "$(curl "${H[@]}" -d '{"channel":"whatsapp"}' $B/hunt/$SH/sent | J "d['ok']")" "True"
check "первое напоминание через 3 дня" "$(Q "select round(extract(epoch from (\"nextFollowUpAt\"-\"sentAt\"))/86400) from \"Outreach\" where id='$SH'")" "3"

echo "4. Дневной лимит"
SET=$(curl "${H[@]}" $B/settings | J "json.dumps({'hunt':{**d['data']['hunt'],'dailyLimit':5}})")
curl "${H[@]}" -X PATCH -d "$SET" $B/settings >/dev/null
SENT=$(Q "select count(*) from \"Activity\" where type='outreach.sent' and \"createdAt\" >= date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'")
for i in $(seq $SENT 5); do Q "insert into \"Activity\"(id,\"tenantId\",type,message,\"createdAt\") select 'fill'||md5(random()::text),id,'outreach.sent','заполнение лимита',now() from \"Tenant\" limit 1" >/dev/null; done
check "сверх лимита — отказ" "$(curl "${H[@]}" -d '{"channel":"telegram"}' $B/hunt/$BU/sent | J "d['error']['code']")" "daily_limit"
check "владелец может превысить" "$(curl "${H[@]}" -d '{"channel":"telegram","force":true}' $B/hunt/$BU/sent | J "d['ok']")" "True"
Q "delete from \"Activity\" where id like 'fill%'" >/dev/null
SET=$(echo "$SET" | sed 's/"dailyLimit": 5/"dailyLimit": 25/'); curl "${H[@]}" -X PATCH -d "$SET" $B/settings >/dev/null

echo "5. Две вкладки одновременно"
PZ=$(oid "E2E Пицца Ready")
R1=$(curl "${H[@]}" -d '{"action":"approve"}' $B/hunt/$PZ/decide | J "d['ok']") 
curl "${H[@]}" -d '{"channel":"telegram"}' $B/hunt/$PZ/sent > $S/a.json & curl "${H[@]}" -d '{"channel":"telegram"}' $B/hunt/$PZ/sent > $S/b.json & wait
OKS=$(cat $S/a.json $S/b.json | grep -c '"ok":true')
check "двойное «Отправил» засчитано один раз" "$OKS" "1"
check "одна запись касания" "$(Q "select count(*) from \"Activity\" where type='outreach.sent' and \"organizationId\"=(select \"organizationId\" from \"Outreach\" where id='$PZ')")" "1"

echo "6. Напоминания → спящий → ответил → срок 24 часа"
for n in 1 2 3; do Q "update \"Outreach\" set \"nextFollowUpAt\"=now()-interval '1 hour' where id='$SH'" >/dev/null; curl "${H[@]}" -d '{"channel":"whatsapp"}' $B/hunt/$SH/followup >/dev/null; done
check "после 3 напоминаний — спящий" "$(Q "select status from \"Outreach\" where id='$SH'")" "sleeping"
curl "${H[@]}" -d '{"status":"replied"}' $B/hunt/$SH/status >/dev/null
check "ответил из «спящих», срок следующего шага 24 ч" "$(Q "select status||round(extract(epoch from (\"nextFollowUpAt\"-now()))/3600) from \"Outreach\" where id='$SH'")" "replied24"

echo "7. Смета только после созвона, проект один"
check "смета сразу после ответа запрещена" "$(curl "${H[@]}" -d '{"status":"estimate"}' $B/hunt/$SH/status | J "d['error']['code']")" "bad_transition"
curl "${H[@]}" -d '{"status":"demo"}' $B/hunt/$SH/status >/dev/null
curl "${H[@]}" -d '{"status":"call"}' $B/hunt/$SH/status >/dev/null
P1=$(curl "${H[@]}" -d '{"status":"estimate"}' $B/hunt/$SH/status | J "d['data']['projectId']")
curl "${H[@]}" -d '{"status":"call"}' $B/hunt/$SH/status >/dev/null
P2=$(curl "${H[@]}" -d '{"status":"estimate"}' $B/hunt/$SH/status | J "d['data']['projectId']")
check "повторная смета не создаёт второй проект" "$P2" "$P1"
check "этап проекта — смета" "$(Q "select stage from \"Project\" where id='$P1'")" "estimate"
curl "${H[@]}" -d '{"status":"won"}' $B/hunt/$SH/status >/dev/null
check "сделка → этап «аванс»" "$(Q "select stage from \"Project\" where id='$P1'")" "prepaid"
check "JSON проекта: схема и демо" "$(curl "${H[@]}" $B/hunt/projects/$P1/json | J "d['schema']+'|'+d['lead']['status']")" "leadflow.project.v1|won"

echo "8. Отказ от сообщений"
curl "${H[@]}" -d '{"status":"optout"}' $B/hunt/$BU/status >/dev/null
check "контакт в стоп-листе" "$(Q "select count(*)>0 from \"SuppressionEntry\" where value='+79990001001'")" "t"
AU=$(oid "E2E Автосервис Check")
Q "insert into \"SuppressionEntry\"(id,\"tenantId\",channel,value,reason,\"createdAt\") select 'e2e'||md5(random()::text),id,'*','+79990001004','тест',now() from \"Tenant\" limit 1 on conflict do nothing" >/dev/null
check "карточка из стоп-листа не в очереди «Проверить»" "$(curl "${H[@]}" $B/hunt/today | J "len([i for i in d['data']['review'] if i['organization']['name']=='E2E Автосервис Check'])")" "0"

echo "9. Обработчик упал — карточка не висит вечно"
Q "update \"Outreach\" set \"cardStatus\"='queued', \"updatedAt\"=now()-interval '30 min' where id=(select h.id from \"Outreach\" h join \"Organization\" o on o.id=h.\"organizationId\" where o.name='E2E Ресторан с сайтом')" >/dev/null
curl "${H[@]}" $B/hunt/today >/dev/null
check "зависшая карточка помечена сбоем" "$(Q "select h.\"cardStatus\" from \"Outreach\" h join \"Organization\" o on o.id=h.\"organizationId\" where o.name='E2E Ресторан с сайтом'")" "failed"
check "повторить сбои ставит в скоринг" "$(curl "${H[@]}" -X POST $B/hunt/retry-failed | J "d['data']['queued']>=1")" "True"

echo "10. Статистика по истории"
check "созвон учтён даже после сделки" "$(curl "${H[@]}" "$B/hunt/stats?days=7" | J "d['data']['calls']>=1")" "True"

echo "11. Состояние системы"
check "обработчик на связи" "$(curl "${H[@]}" $B/hunt/health | J "[c['ok'] for c in d['data']['checks'] if c['key']=='worker'][0]")" "True"
check "AI помечен как неработающий" "$(curl "${H[@]}" $B/hunt/health | J "[c['ok'] for c in d['data']['checks'] if c['key']=='ai'][0]")" "False"

echo; echo "Итого: пройдено $pass, провалено $fail"
