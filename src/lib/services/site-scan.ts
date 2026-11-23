import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError, RetryableError } from "../errors";
import { ParserClient } from "../integrations/parser";
import { isReady, requireReady } from "../integrations/config";
import { logEvent } from "../log";
import { lookup } from "node:dns/promises";
import { cleanSiteUrl, failedScan, isDeadSiteError, isNotASite, mergeScans, scanFromPage, siteKey, subpageLinks, type SiteScan } from "../domain/site-scan";

/** Сайт пересканируем не чаще раза в две недели: он меняется редко, а запрос к парсеру занимает воркер. */
const FRESH_MS = 14 * 24 * 60 * 60 * 1000;
/** Временный сбой (парсер занят, таймаут) повторяем не раньше чем через сутки — без лавины задач в парсере. */
const RETRY_FAILED_MS = 24 * 60 * 60 * 1000;
const SCANNABLE = new Set(["WEBSITE_EXISTS", "UNCERTAIN"]);

type Org = { id: string; tenantId: string; website: string | null; websiteStatus: string; siteScan: Prisma.JsonValue | null };

/** Парсер отвечает 429/503, когда все его компьютеры заняты сбором. Ждём и пробуем ещё — иначе лид теряет факты с сайта. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const temporary = error instanceof RetryableError || (error instanceof ApiError && error.status >= 500);
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
