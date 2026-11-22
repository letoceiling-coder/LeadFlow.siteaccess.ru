import { recordOptOut } from "@/lib/services/opt-outs";

export const dynamic = "force-dynamic";

export default async function OptOutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await recordOptOut(token);
  const title = result.ok ? "Больше не беспокоим" : "Ссылка недействительна";
  const text = result.ok
    ? result.already
      ? `Отказ «${result.name}» уже записан. Мы не напишем повторно.`
      : `Отказ «${result.name}» зафиксирован. Мы больше не напишем и не позвоним по этому предложению.`
    : "Проверьте, что открыта полная ссылка из письма. Если письма продолжают приходить, ответьте на последнее словом «отказ».";
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-white">
      <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-8">
        <p className="text-xs uppercase tracking-wide text-teal-300">LeadFlow</p>
        <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
        <p className="mt-4 text-slate-300">{text}</p>
      </section>
    </main>
  );
}
