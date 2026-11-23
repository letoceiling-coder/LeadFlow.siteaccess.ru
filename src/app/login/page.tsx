"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button, Field, controlClass } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") }) });
      router.replace("/hunt");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось войти");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="hunt hunt-glow lf-dark grid min-h-[100dvh] place-items-center px-4">
      <form action={submit} className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-card">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-700 font-bold text-white">LF</div>
          <div>
            <h1 className="text-xl font-semibold">Вход в LeadFlow</h1>
            <p className="text-sm text-slate-500">Рабочее пространство команды</p>
          </div>
        </div>
        <div className="space-y-4">
          <Field label="Email"><input name="email" type="email" required className={controlClass} /></Field>
          <Field label="Пароль"><input name="password" type="password" required className={controlClass} /></Field>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" pending={pending} className="w-full">Войти</Button>
        </div>
        <p className="mt-4 text-sm text-slate-600">Нет пространства? <Link className="text-teal-800" href="/register">Создать</Link></p>
      </form>
    </main>
  );
}
