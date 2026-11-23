"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button, Card } from "@/components/ui";

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function accept() {
    setPending(true);
    setError("");
    try {
      await api("/api/team/invitations/accept", { method: "POST", body: JSON.stringify({ token: params.token }) });
      router.replace("/hunt");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Приглашение не принято");
      setPending(false);
    }
  }

  return (
    <main className="hunt hunt-glow lf-dark grid min-h-[100dvh] place-items-center px-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold">Приглашение в пространство</h1>
        <p className="mt-2 text-sm text-slate-600">Принять его может только вошедший пользователь с тем же email, на который отправлено приглашение. Код одноразовый.</p>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <Button pending={pending} onClick={accept}>Принять</Button>
          <Link className="rounded-lg border border-line px-3 py-2 text-sm" href="/login">Войти</Link>
        </div>
      </Card>
    </main>
  );
}
