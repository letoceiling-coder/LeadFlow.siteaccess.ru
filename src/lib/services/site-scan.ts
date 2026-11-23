import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError, RetryableError } from "../errors";
import { ParserClient } from "../integrations/parser";
import { isReady, requireReady } from "../integrations/config";
import { logEvent } from "../log";
import { failedScan, isDeadSiteError, scanFromPage, type SiteScan } from "../domain/site-scan";

/** Сайт пересканируем не чаще раза в две недели: он меняется редко, а запрос к парсеру занимает воркер. */
const FRESH_MS = 14 * 24 * 60 * 60 * 1000;
const SCANNABLE = new Set(["WEBSITE_EXISTS", "UNCERTAIN"]);

type Org = { id: string; tenantId: string; website: string | null; websiteStatus: string; siteScan: Prisma.JsonValue | null };

export function storedScan(value: Prisma.JsonValue | null | undefined): SiteScan | null {
  return value && typeof value === "object" && !Array.isArray(value) && "scannedAt" in value ? (value as unknown as SiteScan) : null;
}

function needsScan(org: Org) {
  if (!org.website || !SCANNABLE.has(org.websiteStatus)) return false;
  const scan = storedScan(org.siteScan);
  return !scan || Date.now() - new Date(scan.scannedAt).getTime() > FRESH_MS;
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
  const url = org.website!.startsWith("http") ? org.website! : `https://${org.website}`;
  const started = Date.now();
  let scan: SiteScan;
  try {
    const body = (await client.pageHtml(url, `lf-scan-${org.id}-${new Date().toISOString().slice(0, 10)}`)) as {
      status?: string;
      error?: string | null;
      result?: { html?: string; text?: string; title?: string; httpStatus?: number; finalUrl?: string; timings?: { totalMs?: number } } | null;
    };
    if (body.status !== "completed" || !body.result) {
      scan = failedScan(url, String(body.error ?? `Парсер вернул статус ${body.status ?? "—"}`));
    } else {
      const r = body.result;
      scan = scanFromPage({ url, html: r.html ?? "", text: r.text ?? "", title: r.title, httpStatus: r.httpStatus ?? null, finalUrl: r.finalUrl, loadMs: r.timings?.totalMs ?? Date.now() - started });
    }
  } catch (error) {
    // Лимит частоты или временный сбой парсера — не записываем «сайт мёртв», просто пропускаем скан.
    if (error instanceof RetryableError || (error instanceof ApiError && error.status >= 500)) {
      logEvent("site.scan.skip", { organizationId: org.id, reason: error.message }, "warn");
      return storedScan(org.siteScan);
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
