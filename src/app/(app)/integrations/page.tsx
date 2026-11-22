"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Badge, Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { DEFAULT_API_BASE, DEFAULT_OPENROUTER_PROXY } from "@/lib/integrations/catalog";
import { formatDate } from "@/lib/domain/labels";

type Integration = { id: string; name: string; description: string; instructions: string; status: string; configured: boolean; verified: boolean; lastCheckedAt: string | null; lastError: string | null; config?: { prefix?: string } };

const FIELDS: Record<string, { key: string; label: string; secret?: boolean; config?: boolean }[]> = {
  parser: [{ key: "apiKey", label: "Ключ", secret: true }],
  studio: [{ key: "apiKey", label: "Ключ", secret: true }],
  openrouter: [{ key: "apiKey", label: "Ключ", secret: true }, { key: "proxyUrl", label: "Прокси http://логин:пароль@хост:порт (или direct)", secret: true }],
  email: [{ key: "host", label: "SMTP-хост", secret: true }, { key: "port", label: "Порт", secret: true }, { key: "user", label: "Логин", secret: true }, { key: "password", label: "Пароль", secret: true }, { key: "from", label: "Отправитель", secret: true }],
  telegram: [{ key: "botToken", label: "Токен бота", secret: true }, { key: "chatId", label: "Chat id команды", secret: true }],
  whatsapp: [{ key: "token", label: "Токен", secret: true }, { key: "phoneNumberId", label: "Phone Number ID", secret: true }, { key: "templateName", label: "Имя шаблона", config: true }],
  sms: [{ key: "provider", label: "Провайдер (smsru)", secret: true }, { key: "apiId", label: "api_id", secret: true }],
  sheets: [{ key: "webhookUrl", label: "Ссылка веб-приложения (…/exec)", secret: true }, { key: "token", label: "Токен из Apps Script", secret: true }],
  storage: [{ key: "endpoint", label: "Endpoint", secret: true }, { key: "bucket", label: "Bucket", secret: true }, { key: "region", label: "Регион", secret: true }, { key: "prefix", label: "Папка", config: true }, { key: "accessKey", label: "Access key", secret: true }, { key: "secretKey", label: "Secret key", secret: true }],
};

const STATUS: Record<string, string> = { connected: "проверено", unverified: "сохранено, не проверено", not_configured: "не настроено", error: "ошибка проверки" };

export default function IntegrationsPage() {
  const rows = useResource<Integration[]>("/api/integrations");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (rows.loading) return <Loading />;
  if (rows.error) return <State title="Интеграции недоступны" text={rows.error} />;
  return (
    <div>
      <PageTitle title="Интеграции" text="Ключи хранятся на сервере в зашифрованном виде и обратно целиком не показываются. Статус «проверено» появляется только после успешного пробного запроса. Пустой ответ не считается подключением." />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-teal-800">{notice}</p> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {(rows.data ?? []).map((item) => (
          <Card key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{item.name}</h2>
                <p className="mt-1 text-sm text-slate-600">{item.description}</p>
              </div>
              <Badge tone={item.verified ? "green" : item.status === "error" ? "red" : "slate"}>{STATUS[item.status] || item.status}</Badge>
            </div>
            <p className="mt-2 text-xs text-slate-500">{item.instructions}</p>
            {DEFAULT_API_BASE[item.id as keyof typeof DEFAULT_API_BASE] ? <p className="mt-2 text-sm">Адрес API: {DEFAULT_API_BASE[item.id as keyof typeof DEFAULT_API_BASE]}</p> : null}
            {item.id === "openrouter" ? <p className="text-sm">Прокси: {DEFAULT_OPENROUTER_PROXY}</p> : null}
            {item.id === "storage" ? <p className="mt-2 text-sm">Папка: {item.config?.prefix || "leadflow"}/</p> : null}
            {item.lastError ? <p className="mt-2 text-sm text-red-700">{item.lastError}</p> : null}
            {item.lastCheckedAt ? <p className="text-xs text-slate-500">Проверено {formatDate(item.lastCheckedAt)}</p> : null}
            <form className="mt-3 space-y-2" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const config: Record<string, string> = {};
              const secrets: Record<string, string> = {};
              for (const field of FIELDS[item.id] ?? []) {
                const value = String(form.get(field.key) || "");
                if (!value) continue;
                if (field.config) config[field.key] = value;
                else secrets[field.key] = value;
              }
              api(`/api/integrations/${item.id}`, { method: "PUT", body: JSON.stringify({ config, secrets }) }).then(() => { setNotice(`${item.name}: секрет сохранён. Подключение подтвердится только после проверки.`); setError(""); return rows.reload(); }).catch((reason) => setError(reason.message));
            }}>
              {(FIELDS[item.id] ?? []).map((field) => (
                <Field key={field.key} label={field.label}>
                  <input name={field.key} type={field.secret ? "password" : "text"} className={controlClass} placeholder={field.secret ? "Оставьте пустым, чтобы не менять" : ""} autoComplete="off" />
                </Field>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="secondary">Сохранить</Button>
                <Button type="button" onClick={() => api(`/api/integrations/${item.id}/test`, { method: "POST" }).then(() => { setNotice(`${item.name}: проверка прошла.`); setError(""); return rows.reload(); }).catch((reason) => { setError(reason.message); rows.reload(); })}>Проверить</Button>
                <Button type="button" variant="danger" onClick={() => api(`/api/integrations/${item.id}`, { method: "DELETE" }).then(() => rows.reload()).catch((reason) => setError(reason.message))}>Очистить</Button>
              </div>
            </form>
          </Card>
        ))}
      </div>
    </div>
  );
}
