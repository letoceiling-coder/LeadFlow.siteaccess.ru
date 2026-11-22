"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui";

type OfferFormat = "compact" | "extended" | "followup";

type OfferResult = {
  name?: string;
  subject?: string;
  preheader?: string;
  html?: string;
  siteUrl?: string;
  recipientEmail?: string | null;
  error?: string;
};

const FORMATS: { id: OfferFormat; label: string }[] = [
  { id: "compact", label: "Компактное" },
  { id: "extended", label: "Расширенное" },
  { id: "followup", label: "Повторный контакт" },
];

export function CreateOffer({ organizationId }: { organizationId: string }) {
  const [format, setFormat] = useState<OfferFormat>("compact");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offer, setOffer] = useState<OfferResult | null>(null);

  async function create(next: OfferFormat) {
    setFormat(next);
    setBusy(true);
    setError("");
    try {
      const result = await api<OfferResult>(`/api/organizations/${organizationId}/offer`, {
        method: "POST",
        body: JSON.stringify({ format: next }),
      });
      if (result.error) {
        setOffer(null);
        setError(result.error);
      } else {
        setOffer(result);
      }
    } catch (reason) {
      setOffer(null);
      setError(reason instanceof Error ? reason.message : "Предложение не собрано");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-line bg-white p-4">
      <h2 className="font-semibold">Коммерческое предложение</h2>
      <p className="mb-3 mt-1 text-sm text-slate-500">Собирает черновик письма со скриншотом демонстрационного сайта. Организации ничего не отправляется.</p>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map((item) => (
          <Button key={item.id} type="button" variant={format === item.id ? "primary" : "secondary"} disabled={busy} onClick={() => void create(item.id)}>
            {busy && format === item.id ? "Собираем…" : item.label}
          </Button>
        ))}
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {offer?.html ? (
        <div className="mt-4 space-y-3 text-sm">
          <p><span className="text-slate-500">Тема:</span> {offer.subject}</p>
          <p><span className="text-slate-500">Preheader:</span> {offer.preheader}</p>
          <p><span className="text-slate-500">Сайт в письме:</span> {offer.siteUrl ? <a className="text-teal-800" href={offer.siteUrl} target="_blank" rel="noreferrer">{offer.siteUrl}</a> : "нет"}</p>
          <p className="text-slate-600">{offer.recipientEmail ? `В карточке есть почта ${offer.recipientEmail}. Это только черновик, отправка не выполнялась.` : "В карточке нет почты. Черновик готов, на организацию письмо не уходит."}</p>
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <p className="mb-2 text-slate-500">Компьютер, 640 px</p>
              <iframe title="Письмо на компьютере" sandbox="" srcDoc={offer.html} className="h-[760px] w-[680px] max-w-full rounded-xl border border-line bg-[#e8e3d9]" />
            </div>
            <div>
              <p className="mb-2 text-slate-500">Телефон, 390 px</p>
              <iframe title="Письмо на телефоне" sandbox="" srcDoc={offer.html} className="h-[760px] w-[390px] max-w-full rounded-xl border border-line bg-[#e8e3d9]" />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
