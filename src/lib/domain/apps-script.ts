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
 * Скрипт сам создаёт листы «Лиды» и «Проекты», ставит шапку и обновляет строки по колонке id.
 * Без правильного токена ничего не пишет.
 */
var TOKEN = "__TOKEN__";

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!TOKEN || TOKEN.indexOf("__") === 0 || body.token !== TOKEN) return reply({ ok: false, error: "unauthorized" });
    var book = SpreadsheetApp.getActiveSpreadsheet();
    if (body.action === "ping") return reply({ ok: true, title: book.getName() });
    if (body.action === "upsert") {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        return reply({ ok: true, written: upsert(book, String(body.sheet), body.header || [], body.rows || [], body.key || "id") });
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

function upsert(book, name, header, rows, key) {
  var sheet = book.getSheetByName(name) || book.insertSheet(name);
  var lastCol = sheet.getLastColumn();
  var current = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  if (!current.length || !current[0]) {
    current = header.slice();
    sheet.getRange(1, 1, 1, current.length).setValues([current]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  // Новые колонки дописываются справа, старые не трогаются.
  header.forEach(function (title) {
    if (current.indexOf(title) === -1) {
      current.push(title);
      sheet.getRange(1, current.length).setValue(title).setFontWeight("bold");
    }
  });
  var keyCol = current.indexOf(key);
  var index = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1 && keyCol >= 0) {
    sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues().forEach(function (row, i) { index[String(row[0])] = i + 2; });
  }
  var written = 0;
  rows.forEach(function (row) {
    var values = current.map(function (title) { var v = row[title]; return v === null || v === undefined ? "" : v; });
    var at = index[String(row[key])];
    if (at) {
      sheet.getRange(at, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
      index[String(row[key])] = sheet.getLastRow();
    }
    written++;
  });
  return written;
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
`;

export function appsScript(token: string) {
  return APPS_SCRIPT_TEMPLATE.replace("__TOKEN__", token.replace(/[^A-Za-z0-9_-]/g, ""));
}
