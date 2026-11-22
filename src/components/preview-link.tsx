"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui";

const READY = new Set(["preview_ready", "qa_running", "qa_passed", "qa_failed", "approved", "publish_requested", "published"]);

export function canPreview(status: string) {
  return READY.has(status);
}

export function PreviewLink({ siteId, auto = true }: { siteId: string; auto?: boolean }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(auto);

  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    setPending(true);
    api<{ url: string }>(`/api/sites/${siteId}/preview`, { method: "POST" })
      .then((fresh) => {
        if (!cancelled) setUrl(fresh.url);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Ссылку не удалось получить");
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auto, siteId]);

  async function refresh() {
    setPending(true);
    setError("");
    try {
      const fresh = await api<{ url: string }>(`/api/sites/${siteId}/preview`, { method: "POST" });
      setUrl(fresh.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ссылку не удалось получить");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {url ? (
        <a className="block break-all text-sm text-teal-800 underline" href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      ) : (
        <p className="text-sm text-slate-500">{pending ? "Получаю ссылку на просмотр…" : "Нажмите, чтобы получить ссылку."}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" pending={pending} onClick={() => void refresh()}>
          {url ? "Обновить ссылку" : "Получить ссылку"}
        </Button>
        {url ? (
          <a className="inline-flex items-center rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white" href={url} target="_blank" rel="noreferrer">
            Открыть
          </a>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <p className="text-xs text-slate-500">Ссылка публичная: её можно отправить, страница открывается без входа в Studio.</p>
    </div>
  );
}
