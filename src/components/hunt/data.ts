"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

/** Загрузка с тихим обновлением: после первой загрузки данные не мигают скелетоном. Перезагружается при `version`. */
export function useLive<T>(url: string | null, version = 0, pollMs?: number | false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!url) return;
    try {
      const next = await api<T>(url);
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : "Не удалось загрузить");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => { alive.current = false; };
  }, [reload, version]);

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
