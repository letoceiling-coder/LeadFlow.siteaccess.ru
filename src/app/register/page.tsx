"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button, Field, controlClass } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    setError("");
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          password: formData.get("password"),
          workspaceName: formData.get("workspaceName"),
        }),
      });
      router.replace("/");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать пространство");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form action={submit} className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-card">
        <h1 className="text-xl font-semibold">Новое рабочее пространство</h1>
        <p className="mb-5 mt-1 text-sm text-slate-500">Первый пользователь становится владельцем. Данные других команд сюда не попадают.</p>
        <div className="space-y-4">
          <Field label="Ваше имя"><input name="name" required minLength={2} className={controlClass} /></Field>
          <Field label="Название пространства"><input name="workspaceName" required minLength={2} className={controlClass} /></Field>
          <Field label="Email"><input name="email" type="email" required className={controlClass} /></Field>
          <Field label="Пароль" hint="Не короче 8 символов, с буквой и цифрой"><input name="password" type="password" required minLength={8} className={controlClass} /></Field>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" pending={pending} className="w-full">Создать</Button>
        </div>
        <p className="mt-4 text-sm text-slate-600">Уже есть доступ? <Link className="text-teal-800" href="/login">Войти</Link></p>
      </form>
    </main>
  );
}
