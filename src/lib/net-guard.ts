import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateIp } from "./domain/ip";

/**
 * Защита исходящих запросов на адреса, которые задаёт пользователь (вебхук проекта).
 * Проверяется не строка хоста, а все IP, в которые он резолвится: «x.attacker.com → 127.0.0.1» не пройдёт.
 */

export async function assertPublicTarget(raw: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "адрес не разбирается" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "нужен https" };
  if (url.username || url.password) return { ok: false, reason: "логин и пароль в адресе запрещены" };
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host.includes(".") && !isIP(host)) return { ok: false, reason: "нужно полное доменное имя" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, reason: "внутренний адрес" };
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((item) => item.address);
  } catch {
    return { ok: false, reason: "домен не резолвится" };
  }
  if (!addresses.length || addresses.some(isPrivateIp)) return { ok: false, reason: "адрес ведёт во внутреннюю сеть" };
  return { ok: true, url };
}
