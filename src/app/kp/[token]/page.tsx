import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatPhone, maxLink, telegramLink } from "@/lib/domain/offer";
import { markProposalViewed, publicProposal } from "@/lib/services/proposals";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await publicProposal((await params).token);
  return { title: data ? data.proposal.title : "Предложение", robots: { index: false, follow: false } };
}

function rub(value: number) {
  return `${value.toLocaleString("ru-RU")} ₽`;
}

function Slide({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="kp-slide">
      <div className="mb-5 flex items-baseline gap-3">
        <span className="text-sm font-semibold tabular-nums text-[#c8ff3d]">{n}</span>
        <h2 className="text-[26px] font-semibold leading-tight sm:text-[32px]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default async function ProposalPage({ params }: Props) {
  const data = await publicProposal((await params).token);
  if (!data) notFound();
  await markProposalViewed(data.tenantId, data.organizationId).catch(() => undefined);
  const p = data.proposal;
  const phone = data.reply.phone ? formatPhone(data.reply.phone) : null;
  const tg = data.reply.telegram ? telegramLink(data.reply.telegram) : null;
  const max = data.reply.max ? maxLink(data.reply.max) : null;
  const email = data.reply.email || null;
  let n = 0;
  const num = () => String(++n).padStart(2, "0");

  return (
    <main className="min-h-dvh bg-[#0b0b0d] text-[#f4f4f5]">
      <style>{`.kp-slide{padding:48px 0;border-top:1px solid rgba(255,255,255,.08)} @media print{.kp-slide{break-inside:avoid;padding:24px 0} .no-print{display:none}}`}</style>
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <header className="pb-12 pt-14 sm:pt-20">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">
            Предложение для {p.business.name}
            {p.business.city ? ` · ${p.business.city}` : ""}
          </div>
          <h1 className="text-[34px] font-semibold leading-[1.08] tracking-tight sm:text-[48px]">{p.title}</h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-white/75">{p.intro}</p>
          {p.business.reviewCount ? (
            <div className="mt-6 flex gap-6 text-sm text-white/60">
              {p.business.rating ? <div><div className="text-2xl font-semibold tabular-nums text-white">{p.business.rating.toFixed(1)}</div>рейтинг на картах</div> : null}
              <div><div className="text-2xl font-semibold tabular-nums text-white">{p.business.reviewCount}</div>отзывов</div>
            </div>
          ) : null}
        </header>

        {p.seen.length ? (
          <Slide n={num()} title="Что мы увидели">
            <ul className="space-y-2.5">
              {p.seen.map((item) => (
                <li key={item} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-[16px]">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c8ff3d]" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[16px] leading-relaxed text-white/70">{p.pain}</p>
            {p.calc ? <p className="mt-3 rounded-2xl bg-[#c8ff3d]/10 px-4 py-3 text-[15px] text-[#e5ffa3]">{p.calc}</p> : null}
          </Slide>
        ) : null}

        <Slide n={num()} title="Что предлагаем">
          <p className="mb-4 text-[18px] font-medium">{p.product}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {p.features.map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-[15px] leading-snug">{item}</div>
            ))}
          </div>
          <p className="mt-4 text-[15px] text-white/60">Демо до оплаты: {p.demo.charAt(0).toLowerCase() + p.demo.slice(1)}.</p>
        </Slide>

        <Slide n={num()} title="Варианты и цены">
          <div className="grid gap-3 sm:grid-cols-3">
            {p.packages.map((item) => (
              <div key={item.key} className={`flex flex-col rounded-3xl border p-5 ${item.recommended ? "border-[#c8ff3d]/60 bg-[#c8ff3d]/[0.07]" : "border-white/10 bg-white/[0.04]"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[17px] font-semibold">{item.name}</span>
                  {item.recommended ? <span className="rounded-full bg-[#c8ff3d] px-2 py-0.5 text-[11px] font-semibold text-black">Советуем</span> : null}
                </div>
                <div className="mt-3 text-[28px] font-semibold tabular-nums">{rub(item.priceRub)}</div>
                <div className="text-sm text-white/55">{item.days}</div>
                <ul className="mt-4 space-y-1.5 text-[14px] text-white/80">
                  {item.items.map((line) => <li key={line}>— {line}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-white/50">Это вилка по похожим проектам. Точную смету даём после 15-минутного созвона — без сюрпризов в процессе.</p>
        </Slide>

        <Slide n={num()} title="Как работаем">
          <ol className="space-y-2">
            {p.stages.map((stage, index) => (
              <li key={stage} className="flex items-center gap-3 text-[16px]">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 text-sm tabular-nums text-white/70">{index + 1}</span>
                {stage}
              </li>
            ))}
          </ol>
          {p.caseRef ? <p className="mt-4 text-[15px] text-white/60">Похожий проект в портфолио: {p.caseRef}.</p> : null}
        </Slide>

        <Slide n={num()} title="Следующий шаг">
          <p className="text-[18px] leading-relaxed">{p.nextStep}</p>
          <div className="no-print mt-6 flex flex-wrap gap-3">
            {tg ? <a href={tg} className="inline-flex h-12 items-center rounded-full bg-[#c8ff3d] px-6 font-semibold text-black">Написать в Telegram</a> : null}
            {max ? <a href={max} className="inline-flex h-12 items-center rounded-full border border-white/15 px-6 font-medium">Написать в MAX</a> : null}
            {phone ? <a href={phone.href} className="inline-flex h-12 items-center rounded-full border border-white/15 px-6 font-medium">{phone.display}</a> : null}
            {email ? <a href={`mailto:${email}`} className="inline-flex h-12 items-center rounded-full border border-white/15 px-6 font-medium">{email}</a> : null}
          </div>
        </Slide>
        <footer className="pb-12 pt-6 text-xs text-white/35">Предложение подготовлено {new Date(p.createdAt).toLocaleDateString("ru-RU")}. Цены действительны 14 дней.</footer>
      </div>
    </main>
  );
}
