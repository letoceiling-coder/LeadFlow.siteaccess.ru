"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Mail, Send } from "lucide-react";
import { api } from "@/lib/client";
import { Button, Field, cnJoin, controlClass } from "@/components/ui";

type Flow = { status: "ok"; user: { name: string; tenantName: string } } | { status: "pending"; name: string; contact: string };
type Method = "email" | "telegram" | "password";

/**
 * Один блок для входа, регистрации и ссылки-приглашения.
 * Почта: адрес → 6-значный код из письма. Telegram: кнопка → бот → «Подтвердить вход». Пароль — для тех, у кого он задан.
 */
export function AuthPanel({ mode, inviteToken, allowRegister = true }: { mode: "login" | "register" | "invite"; inviteToken?: string; allowRegister?: boolean }) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("email");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [tg, setTg] = useState<{ code: string; link: string; opened: boolean } | null>(null);
  const [result, setResult] = useState<Flow | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const askName = mode !== "login";

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  function done(flow: Flow) {
    if (flow.status === "ok") {
      router.replace("/hunt");
      router.refresh();
      return;
    }
    setResult(flow);
  }

  function fail(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "Не получилось. Попробуйте ещё раз.");
  }

  async function sendCode() {
    setPending(true);
    setError("");
    try {
      const row = await api<{ sent: boolean; dev: boolean }>("/api/auth/email/request", { method: "POST", body: JSON.stringify({ email, name: name || null, inviteToken: inviteToken || null }) });
      setCodeSent(true);
      setDevCode(row.dev);
      setCooldown(60);
    } catch (reason) {
      fail(reason);
    } finally {
      setPending(false);
    }
  }

  async function verifyCode() {
    setPending(true);
    setError("");
    try {
      done(await api<Flow>("/api/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code, inviteToken: inviteToken || null }) }));
    } catch (reason) {
      fail(reason);
    } finally {
      setPending(false);
    }
  }

  async function startTelegram() {
    setPending(true);
    setError("");
    try {
      const row = await api<{ code: string; link: string }>("/api/auth/telegram/start", { method: "POST", body: JSON.stringify({ name: name || null, inviteToken: inviteToken || null }) });
      setTg({ code: row.code, link: row.link, opened: false });
      poll(row.code, Date.now());
    } catch (reason) {
      fail(reason);
    } finally {
      setPending(false);
    }
  }

  function poll(tgCode: string, startedAt: number) {
    pollTimer.current = setTimeout(async () => {
      try {
        const row = await api<Flow | { status: "waiting"; opened: boolean }>("/api/auth/telegram/poll", { method: "POST", body: JSON.stringify({ code: tgCode }) });
        if (row.status === "waiting") {
          setTg((current) => (current ? { ...current, opened: row.opened } : current));
          if (Date.now() - startedAt < 10 * 60 * 1000) poll(tgCode, startedAt);
          else {
            setTg(null);
            setError("Время ожидания вышло. Нажмите «Войти через Telegram» ещё раз.");
          }
          return;
        }
        setTg(null);
        done(row);
      } catch (reason) {
        setTg(null);
        fail(reason);
      }
    }, 2000);
  }

  async function passwordLogin(form: FormData) {
    setPending(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      router.replace("/hunt");
      router.refresh();
    } catch (reason) {
      fail(reason);
    } finally {
      setPending(false);
    }
  }

  if (result?.status === "pending") {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-teal-600" />
        <h2 className="mt-3 text-lg font-semibold">Заявка отправлена</h2>
        <p className="mt-2 text-sm text-slate-600">
          {result.name}, вы зарегистрированы как <b>{result.contact}</b>. Администратор откроет доступ к рабочему пространству — мы сообщим {result.contact.includes("@") && !result.contact.startsWith("@") ? "письмом" : "в Telegram"}.
        </p>
        <p className="mt-3 text-sm text-slate-500">После этого просто войдите тем же способом.</p>
        <Button variant="secondary" className="mt-5" onClick={() => { setResult(null); setCodeSent(false); setCode(""); }}>Понятно</Button>
      </div>
    );
  }

  const tabs: { id: Method; label: string; icon: typeof Mail }[] = [
    { id: "email", label: "Почта", icon: Mail },
    { id: "telegram", label: "Telegram", icon: Send },
    ...(mode === "login" ? [{ id: "password" as const, label: "Пароль", icon: KeyRound }] : []),
  ];

  return (
    <div>
      <div role="tablist" className="mb-5 grid gap-1 rounded-full bg-slate-100 p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={method === tab.id}
              onClick={() => { setMethod(tab.id); setError(""); }}
              className={cnJoin("flex h-10 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition", method === tab.id ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink")}
            >
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {method === "email" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (codeSent) verifyCode();
            else sendCode();
          }}
        >
          {askName && !codeSent ? <Field label="Как вас зовут"><input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required={mode === "register"} autoComplete="name" className={controlClass} /></Field> : null}
          <Field label="Почта">
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required autoComplete="email" readOnly={codeSent} className={cnJoin(controlClass, codeSent && "bg-slate-50 text-slate-500")} />
          </Field>
          {codeSent ? (
            <Field label="Код из письма" hint={devCode ? "Почта не настроена: в режиме разработки код напечатан в логе сервера." : "Проверьте «Входящие» и «Спам». Код действует 10 минут."}>
              <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus required pattern="\d{6}" placeholder="000000" className={cnJoin(controlClass, "text-center text-lg tracking-[0.4em]")} />
            </Field>
          ) : null}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" pending={pending} className="w-full">{codeSent ? "Войти" : "Получить код"}</Button>
          {codeSent ? (
            <div className="flex justify-between text-sm">
              <button type="button" className="text-slate-500 hover:text-ink" onClick={() => { setCodeSent(false); setCode(""); setError(""); }}>Другая почта</button>
              <button type="button" disabled={cooldown > 0 || pending} className="text-teal-800 disabled:text-slate-400" onClick={sendCode}>{cooldown > 0 ? `Новый код через ${cooldown} с` : "Отправить код ещё раз"}</button>
            </div>
          ) : null}
        </form>
      ) : null}

      {method === "telegram" ? (
        <div className="space-y-4">
          {askName && !tg ? <Field label="Как вас зовут" hint="Необязательно — возьмём имя из Telegram"><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" className={controlClass} /></Field> : null}
          {tg ? (
            <div className="rounded-2xl border border-line bg-slate-50 p-4 text-sm">
              <ol className="list-decimal space-y-1.5 pl-5 text-slate-700">
                <li>Откройте бота кнопкой ниже и нажмите <b>«Start»</b> (или «Запустить»).</li>
                <li>В боте нажмите <b>«✅ Подтвердить вход»</b>.</li>
                <li>Эта страница откроется сама.</li>
              </ol>
              <a href={tg.link} target="_blank" rel="noreferrer" className="mt-4 flex h-11 items-center justify-center gap-2 rounded-full bg-[#229ED9] text-sm font-semibold text-white">
                <Send className="h-4 w-4" /> Открыть Telegram
              </a>
              <p className="mt-3 text-center text-xs text-slate-500">{tg.opened ? "Бот получил запрос — подтвердите вход в Telegram…" : "Ждём, пока вы откроете бота…"}</p>
            </div>
          ) : (
            <Button pending={pending} className="w-full !bg-[#229ED9] hover:!bg-[#1b8cc2]" onClick={startTelegram}><Send className="h-4 w-4" /> Войти через Telegram</Button>
          )}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {tg ? <button type="button" className="w-full text-center text-sm text-slate-500" onClick={() => { if (pollTimer.current) clearTimeout(pollTimer.current); setTg(null); }}>Отмена</button> : null}
        </div>
      ) : null}

      {method === "password" ? (
        <form action={passwordLogin} className="space-y-4">
          <Field label="Почта"><input name="email" type="email" required autoComplete="email" className={controlClass} /></Field>
          <Field label="Пароль"><input name="password" type="password" required autoComplete="current-password" className={controlClass} /></Field>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" pending={pending} className="w-full">Войти</Button>
        </form>
      ) : null}

      {mode === "login" ? (
        allowRegister ? (
          <p className="mt-5 text-center text-sm text-slate-600">Впервые здесь? <Link className="font-medium text-teal-800" href="/register">Зарегистрироваться</Link></p>
        ) : (
          <p className="mt-5 text-center text-sm text-slate-600">Нет доступа? Его выдаёт администратор.</p>
        )
      ) : mode === "register" ? (
        <p className="mt-5 text-center text-sm text-slate-600">Уже есть доступ? <Link className="font-medium text-teal-800" href="/login">Войти</Link></p>
      ) : null}
    </div>
  );
}

export function AuthCard({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <main className="hunt hunt-glow lf-dark grid min-h-[100dvh] place-items-center px-4 py-8">
      <section className="w-full max-w-md rounded-3xl border border-line bg-white p-6 shadow-card">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-700 font-bold text-white">LF</div>
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="text-sm text-slate-500">{text}</p>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}
