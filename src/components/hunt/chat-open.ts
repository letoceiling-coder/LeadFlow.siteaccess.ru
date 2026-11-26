"use client";

import { ApiClientError } from "@/lib/client";
import { post } from "./data";
import type { ChatTarget } from "./types";

/**
 * «Скопировать и открыть чат»: копирует текст и сразу открывает Telegram или MAX — в том же нажатии,
 * иначе мобильный браузер заблокирует новое окно. Отправляет человек сам.
 */
export function copyAndOpen(text: string, target: ChatTarget | null) {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    /* буфер недоступен — текст останется на экране */
  }
  if (target?.href) window.open(target.href, "_blank", "noopener");
}

export type TouchResult = { touchId: string; kind: string; next?: string | null; silent?: boolean };

/** Записывает касание. Дневной лимит владелец или админ может превысить после подтверждения. */
export async function saveTouch(id: string, body: { kind: "first" | "followup"; channel: string; variant?: string | null; text: string }, role: string) {
  const payload = { ...body, variant: body.variant ?? undefined };
  try {
    return await post<TouchResult>(`/api/hunt/${id}/touch`, payload);
  } catch (reason) {
    const canForce = ["OWNER", "ADMIN"].includes(role);
    if (!(reason instanceof ApiClientError && reason.code === "daily_limit" && canForce && window.confirm(`${reason.message}\n\nВсё равно записать?`))) throw reason;
    return post<TouchResult>(`/api/hunt/${id}/touch`, { ...payload, force: true });
  }
}

export const TOUCH_LABEL: Record<string, string> = { day1: "Первое", day4: "День 4", day8: "День 8" };
export const CHANNEL_LABEL: Record<string, string> = { telegram: "Telegram", max: "MAX", whatsapp: "WhatsApp", vk: "VK", email: "Почта", phone: "Звонок", instagram: "Instagram", avito: "Авито", other: "Другое" };
