/** Код веб-приложения Apps Script для Google Таблицы. LeadFlow подставляет токен и даёт скопировать целиком. */
export const APPS_SCRIPT_TEMPLATE = `/**
 * LeadFlow → Google Таблица.
 *
 * 1. Откройте таблицу → Расширения → Apps Script. Удалите всё и вставьте этот файл.
 * 2. Токен ниже уже совпадает с тем, что LeadFlow показал вместе с этим кодом.
 * 3. Развернуть → Новое развёртывание → Тип «Веб-приложение»:
 *      Выполнять как: «Я»;  У кого есть доступ: «Все».
 * 4. Скопируйте ссылку …/exec → LeadFlow → Охота → Настройки → Google Таблицы → «Подключить».
 *
 * Скрипт сам создаёт листы по нишам («Автосервисы», «Доставка еды», «Без ниши»…) и «Проекты»,
 * ставит шапку и обновляет строки по колонке id. Свои колонки справа (комментарий, статус звонка…)
 * можно добавлять — LeadFlow их не затирает.
 * Без правильного токена ничего не пишет.
 */
var TOKEN = "__TOKEN__";

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!TOKEN || TOKEN.length < 20 || body.token !== TOKEN) return reply({ ok: false, error: "unauthorized" });
    var book = SpreadsheetApp.getActiveSpreadsheet();
    if (body.action === "ping") return reply({ ok: true, title: book.getName() });
    if (body.action === "upsert") {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        return reply({ ok: true, written: upsert(book, String(body.sheet), body.header || [], body.rows || [], body.key || "id", body.family || []) });
      } finally {
        lock.releaseLock();
      }
    }
    return reply({ ok: false, error: "unknown action" });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err).slice(0, 150) });
  }
}

function doGet() {
  return reply({ ok: true, title: SpreadsheetApp.getActiveSpreadsheet().getName(), hint: "LeadFlow пишет сюда через POST" });
}

function upsert(book, name, header, rows, key, family) {
  family = family || [];
  if (name !== "Проекты" && family.indexOf(name) === -1) throw new Error("unknown sheet");
  if (name.length > 90 || ["[", "]", "*", "?", "/", ":"].some(function (c) { return name.indexOf(c) !== -1; })) throw new Error("bad sheet name");
  var sheet = book.getSheetByName(name) || book.insertSheet(name);
  var current = headerOf(sheet);
  if (!current.length || !current[0]) {
    current = header.slice();
    sheet.getRange(1, 1, 1, current.length).setValues([current]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  // Новые колонки дописываются справа, старые не трогаются.
  header.forEach(function (title) { addColumn(sheet, current, title); });
  var index = indexOf(sheet, current, key);

  // Строки этого же лида на других листах группы (сменилась ниша) — забираем вместе с ручными колонками.
  var others = family.filter(function (n) { return n !== name; }).map(function (n) { return book.getSheetByName(n); }).filter(Boolean).map(function (other) {
    var cols = headerOf(other);
    return { sheet: other, cols: cols, index: indexOf(other, cols, key), drop: [] };
  });

  var written = 0;
  rows.forEach(function (row) {
    var id = String(row[key]);
    var base = {};
    var at = index[id];
    if (at) base = rowObject(sheet, current, at);
    others.forEach(function (o) {
      var from = o.index[id];
      if (!from) return;
      var old = rowObject(o.sheet, o.cols, from);
      Object.keys(old).forEach(function (title) {
        if (old[title] === "" || old[title] === null) return;
        addColumn(sheet, current, title);
        if (base[title] === undefined || base[title] === "") base[title] = old[title];
      });
      o.drop.push(from);
    });
    // Колонки LeadFlow обновляются, а свои колонки (комментарий, договорились, сумма…) остаются как были.
    var values = current.map(function (title) { return header.indexOf(title) !== -1 ? safe(row[title]) : (base[title] === undefined ? "" : base[title]); });
    if (at) {
      sheet.getRange(at, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
      index[id] = sheet.getLastRow();
    }
    written++;
  });
  others.forEach(function (o) {
    o.drop.sort(function (a, b) { return b - a; }).forEach(function (r) { o.sheet.deleteRow(r); });
  });
  return written;
}

function headerOf(sheet) {
  var lastCol = sheet.getLastColumn();
  return lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
}

function addColumn(sheet, current, title) {
  if (current.indexOf(title) !== -1) return;
  current.push(title);
  sheet.getRange(1, current.length).setValue(title).setFontWeight("bold");
}

function indexOf(sheet, cols, key) {
  var map = {};
  var keyCol = cols.indexOf(key);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1 && keyCol >= 0) {
    sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues().forEach(function (r, i) { map[String(r[0])] = i + 2; });
  }
  return map;
}

function rowObject(sheet, cols, at) {
  var data = {};
  if (!cols.length) return data;
  var values = sheet.getRange(at, 1, 1, cols.length).getValues()[0];
  cols.forEach(function (title, i) { if (title) data[title] = values[i]; });
  return data;
}

// Значение из чужих данных не должно стать формулой: «=IMPORTXML(...)» в названии компании.
function safe(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" && /^[=+\\-@\\t\\r]/.test(v)) return "'" + v;
  return v;
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
`;

export function appsScript(token: string) {
  return APPS_SCRIPT_TEMPLATE.replace("__TOKEN__", token.replace(/[^A-Za-z0-9_-]/g, ""));
}
