"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

/** Загрузка с тихим обновлением: после первой загрузки данные не мигают скелетоном. Перезагружается при `version`. */
export function useLive<T>(url: string | null, version = 0, pollMs?: number | false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  // Каждый запрос получает номер: поздний ответ от старого адреса (другая карточка) отбрасывается.
  const latest = useRef(0);
  const shownUrl = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!url) return;
    const ticket = ++latest.current;
    try {
      const next = await api<T>(url);
      if (ticket !== latest.current) return;
      shownUrl.current = url;
      setData(next);
      setError(null);
    } catch (reason) {
      if (ticket === latest.current) setError(reason instanceof Error ? reason.message : "Не удалось загрузить");
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (shownUrl.current !== url) {
      // Новый адрес — чужие данные и ошибку не показываем.
      setData(null);
      setError(null);
      setLoading(Boolean(url));
    }
    void reload();
    return () => { latest.current += 1; };
  }, [reload, version, url]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, reload]);

  return { data, error, loading: loading && !data, reload, setData };
}

export async function post<T = unknown>(url: string, body?: unknown, method = "POST") {
  return api<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}
