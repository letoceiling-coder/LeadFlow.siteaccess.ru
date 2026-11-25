import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError, RetryableError } from "../errors";
import { ParserClient } from "../integrations/parser";
import { isReady, requireReady } from "../integrations/config";
import { logEvent } from "../log";
import { lookup } from "node:dns/promises";
import { assertPublicTarget } from "../net-guard";
import { cleanSiteUrl, failedScan, isDeadSiteError, isNotASite, mergeScans, scanFromPage, siteKey, subpageLinks, type SiteScan } from "../domain/site-scan";

/** Сайт пересканируем не чаще раза в две недели: он меняется редко, а запрос к парсеру занимает воркер. */
const FRESH_MS = 14 * 24 * 60 * 60 * 1000;
/** Временный сбой (парсер занят, таймаут) повторяем не раньше чем через сутки — без лавины задач в парсере. */
const RETRY_FAILED_MS = 24 * 60 * 60 * 1000;
const PARSER_BROKEN = "Браузер парсера не смог прочитать сайт";
const SCANNABLE = new Set(["WEBSITE_EXISTS", "UNCERTAIN"]);

type Org = { id: string; tenantId: string; website: string | null; websiteStatus: string; siteScan: Prisma.JsonValue | null };

/**
 * Браузер парсера иногда падает на самой странице («page.evaluate: TypeError: result is not a function»):
 * сайт ломает его скрипт. Это не временный сбой — повтор на другом сервере даст ту же ошибку.
 */
function isParserScriptError(error: unknown) {
  return error instanceof Error && /page\.evaluate|UtilityScript|is not a function/i.test(error.message);
}

/** Прямое чтение HTML с сервера LeadFlow (без браузера) — для сайтов, на которых падает браузер парсера. */
async function fetchDirect(raw: string): Promise<{ html: string; text: string; title: string | null; httpStatus: number; finalUrl: string; loadMs: number }> {
  const started = Date.now();
  let current = raw;
  for (let hop = 0; hop < 4; hop += 1) {
    const target = await assertPublicTarget(current, { allowHttp: true });
    if (!target.ok) throw new Error(`Сайт нельзя открыть напрямую: ${target.reason}`);
    const response = await fetch(target.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", Accept: "text/html,*/*;q=0.8", "Accept-Language": "ru,en;q=0.8" },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, target.url).toString();
      continue;
    }
    const buffer = Buffer.from(await response.arrayBuffer()).subarray(0, 1_500_000);
    const charset = /charset=([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(buffer.toString("latin1").slice(0, 4000))?.[1] ?? "utf-8";
    let html: string;
    try { html = new TextDecoder(charset.toLowerCase()).decode(buffer); } catch { html = buffer.toString("utf8"); }
    html = html.replace(/(href|src)=(["'])(?!https?:|mailto:|tel:|#|data:|javascript:)([^"']*)\2/gi, (_, attr, q, value) => {
      try { return `${attr}=${q}${new URL(value, target.url).toString()}${q}`; } catch { return `${attr}=${q}${value}${q}`; }
    });
    const text = html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
    return { html, text, title, httpStatus: response.status, finalUrl: target.url.toString(), loadMs: Date.now() - started };
  }
  throw new Error("Слишком много перенаправлений");
}

export async function scanDirect(org: Org, url: string): Promise<SiteScan> {
  const page = await fetchDirect(url);
  let scan = scanFromPage({ url, ...page });
  if (scan.ok && !(scan.booking && scan.cart && scan.prices)) {
    const extra: SiteScan[] = [];
    for (const sub of subpageLinks(page.html, scan.url)) {
      try {
        const next = await fetchDirect(sub);
        extra.push(scanFromPage({ url: sub, ...next }));
      } catch { /* внутренняя страница не открылась — судим по тому, что есть */ }
    }
    scan = { ...mergeScans(scan, extra), pages: 1 + extra.length } as SiteScan;
  }
  logEvent("site.scan.direct", { organizationId: org.id, url, ok: scan.ok });
  return scan;
}

/** Парсер отвечает 429/503, когда все его компьютеры заняты сбором. Ждём и пробуем ещё — иначе лид теряет факты с сайта. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const temporary = !isParserScriptError(error) && (error instanceof RetryableError || (error instanceof ApiError && error.status >= 500));
      if (!temporary || i >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15_000 * i));
    }
  }
}

export function storedScan(value: Prisma.JsonValue | null | undefined): SiteScan | null {
  return value && typeof value === "object" && !Array.isArray(value) && "scannedAt" in value ? (value as unknown as SiteScan) : null;
}

function needsScan(org: Org) {
  if (!org.website || !SCANNABLE.has(org.websiteStatus) || isNotASite(org.website)) return false;
  const scan = storedScan(org.siteScan);
  if (!scan) return true;
  const age = Date.now() - new Date(scan.scannedAt).getTime();
  if (!scan.ok && scan.error && isDeadSiteError(scan.error)) return age > FRESH_MS;
  // Сайт ломает браузер парсера — не гоняем его туда каждые сутки, пробуем раз в две недели.
  if (!scan.ok && scan.error?.startsWith(PARSER_BROKEN)) return age > FRESH_MS;
  return age > (scan.ok ? FRESH_MS : RETRY_FAILED_MS);
}

/** Домен не резолвится — не отправляем задачу в парсер вовсе (иначе каждая попытка — ошибка у оператора парсера). */
async function domainResolves(url: string) {
  try {
    await lookup(new URL(url).hostname);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    return !(code === "ENOTFOUND" || code === "ENODATA" || code === "EAI_NONAME");
  }
}

/** Точки одной сети ссылаются на один сайт: берём свежий скан соседа вместо нового запроса к парсеру. */
async function siblingScan(org: Org, url: string): Promise<SiteScan | null> {
  const key = siteKey(url);
  const host = key.split("/")[0];
  const rows = await prisma.organization.findMany({
    where: { tenantId: org.tenantId, id: { not: org.id }, website: { contains: host, mode: "insensitive" }, websiteCheckedAt: { gte: new Date(Date.now() - FRESH_MS) } },
    select: { website: true, siteScan: true },
    take: 20,
  });
  for (const row of rows) {
    const scan = storedScan(row.siteScan);
    if (scan && row.website && siteKey(row.website) === key && (scan.ok || (scan.error && isDeadSiteError(scan.error)))) return scan;
  }
  return null;
}

/**
 * Открывает сайт лида через браузер парсера, сохраняет скан и найденные контакты (почта, мессенджеры, телефоны).
 * Сбой сети не ломает квалификацию: карточка соберётся по данным карт, скан повторится в следующий раз.
 */
export async function scanSite(org: Org): Promise<SiteScan | null> {
  if (!needsScan(org)) return storedScan(org.siteScan);
  if (!(await isReady(org.tenantId, "parser"))) return storedScan(org.siteScan);
  const integration = await requireReady(org.tenantId, "parser", "Скан сайта");
  const client = new ParserClient(String(integration.config.baseUrl), integration.secrets.apiKey);
  const url = cleanSiteUrl(org.website!);
  const started = Date.now();
  let scan: SiteScan;
  const shared = await siblingScan(org, url);
  if (shared) {
    await saveScan(org, shared);
    logEvent("site.scan.shared", { organizationId: org.id, url });
    return shared;
  }
  if (!(await domainResolves(url))) {
    scan = failedScan(url, "net::ERR_NAME_NOT_RESOLVED — домен из карточки не существует (проверено без парсера)");
    await saveScan(org, scan);
    logEvent("site.scan.dead_domain", { organizationId: org.id, url });
    return scan;
  }
  try {
    const body = (await withRetry(() => client.pageHtml(url, `lf-scan-${org.id}-${new Date().toISOString().slice(0, 10)}`))) as {
      status?: string;
      error?: string | null;
      result?: { html?: string; text?: string; title?: string; httpStatus?: number; finalUrl?: string; timings?: { totalMs?: number } } | null;
    };
    if (body.status !== "completed" || !body.result) {
      scan = failedScan(url, String(body.error ?? `Парсер вернул статус ${body.status ?? "—"}`));
    } else {
      const r = body.result;
      scan = scanFromPage({ url, html: r.html ?? "", text: r.text ?? "", title: r.title, httpStatus: r.httpStatus ?? null, finalUrl: r.finalUrl, loadMs: r.timings?.totalMs ?? Date.now() - started });
      // Главная часто витрина: меню, цены и запись живут на внутренних страницах. Без них выводы о «нет корзины» ложные.
      if (scan.ok && !(scan.booking && scan.cart && scan.prices)) {
        const extra: SiteScan[] = [];
        for (const sub of subpageLinks(r.html ?? "", scan.url)) {
          try {
            const page = (await client.pageHtml(sub, `lf-scan-${org.id}-${sub.length}-${new Date().toISOString().slice(0, 10)}`)) as typeof body;
            if (page.status === "completed" && page.result) extra.push(scanFromPage({ url: sub, html: page.result.html ?? "", text: page.result.text ?? "", httpStatus: page.result.httpStatus ?? null, finalUrl: page.result.finalUrl }));
          } catch { /* внутренняя страница не открылась — судим по тому, что есть */ }
        }
        scan = { ...mergeScans(scan, extra), pages: 1 + extra.length } as SiteScan;
      }
    }
  } catch (error) {
    if (isParserScriptError(error)) {
      // Браузер парсера не справился с этим сайтом — читаем страницу напрямую с сервера, без повторов в парсере.
      logEvent("site.scan.parser_script_error", { organizationId: org.id, url, error: error instanceof Error ? error.message.slice(0, 200) : "" }, "warn");
      try {
        scan = await scanDirect(org, url);
        if (!scan.ok) scan = { ...scan, error: `${PARSER_BROKEN}; без браузера: ${scan.error ?? "—"}` };
      } catch (direct) {
        scan = failedScan(url, `${PARSER_BROKEN}; без браузера: ${direct instanceof Error ? direct.message : String(direct)}`);
      }
      await saveScan(org, scan);
      return scan;
    }
    // Лимит частоты или временный сбой парсера — не записываем «сайт мёртв», просто пропускаем скан.
    if (error instanceof RetryableError || (error instanceof ApiError && error.status >= 500)) {
      // Фиксируем временный сбой со временем: следующая попытка — через сутки, а не при каждом пересчёте.
      logEvent("site.scan.skip", { organizationId: org.id, reason: error.message }, "warn");
      const previous = storedScan(org.siteScan);
      if (previous?.ok) return previous;
      await saveScan(org, failedScan(url, `Временный сбой парсера: ${error.message}`));
      return null;
    }
    scan = failedScan(url, error instanceof Error ? error.message : String(error));
  }
  await saveScan(org, scan);
  logEvent("site.scan", { organizationId: org.id, ok: scan.ok, emails: scan.emails.length, links: scan.links.length, phones: scan.phones.length, ms: Date.now() - started });
  return scan;
}

async function saveScan(org: Org, scan: SiteScan) {
  const dead = !scan.ok && scan.error != null && isDeadSiteError(scan.error);
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      siteScan: scan as unknown as Prisma.InputJsonValue,
      websiteCheckedAt: new Date(),
      websiteCheckNote: scan.ok ? `Открылся${scan.title ? `: ${scan.title}` : ""}` : `Не открылся: ${scan.error ?? "—"}`.slice(0, 300),
      ...(dead ? { websiteStatus: "BROKEN_WEBSITE" } : {}),
    },
  });
  const contacts = [
    ...scan.emails.map((value) => ({ type: "email", value, label: "с сайта" })),
    ...scan.phones.map((value) => ({ type: "phone", value, label: "с сайта" })),
    ...scan.links.map((link) => ({ type: "social", value: link.url, label: link.kind })),
  ];
  if (!contacts.length) return;
  await prisma.organizationContact.createMany({
    data: contacts.map((item) => ({ tenantId: org.tenantId, organizationId: org.id, type: item.type, value: item.value, label: item.label, source: "site" })),
    skipDuplicates: true,
  });
}
