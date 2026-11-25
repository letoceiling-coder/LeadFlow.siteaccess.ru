"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { AuthCard, AuthPanel } from "@/components/auth-panel";
import { Button, Loading } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/domain/labels";

type Info = { tenantName: string; role: string; email: string | null };
type Me = { user: { name: string; email: string } } | null;

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<Info>(`/api/auth/invite/${params.token}`).then(setInfo).catch((reason) => setError(reason.message));
    // Без api(): он уводит на /login при 401, а здесь гость — нормальная ситуация.
    fetch("/api/auth/me").then((response) => (response.ok ? response.json() : null)).then((body) => setMe(body?.data ?? null)).catch(() => setMe(null));
  }, [params.token]);

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

  if (error && !info) {
    return (
      <AuthCard title="Приглашение" text="Ссылка на доступ в LeadFlow">
        <p className="text-sm text-red-700">{error}</p>
      </AuthCard>
    );
  }
  if (!info || me === undefined) {
    return (
      <AuthCard title="Приглашение" text="Ссылка на доступ в LeadFlow">
        <Loading />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Вас пригласили в LeadFlow" text={`Пространство «${info.tenantName}» · ${ROLE_LABEL[info.role] ?? info.role}`}>
      {info.email ? <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Приглашение выписано на <b>{info.email}</b> — войдите с этой почтой.</p> : null}
      {me ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Вы вошли как <b>{me.user.name}</b>. Принять приглашение для этой учётной записи?</p>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button pending={pending} className="w-full" onClick={accept}>Принять и открыть</Button>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">Войдите любым удобным способом — доступ откроется сразу, ждать одобрения не нужно.</p>
          <AuthPanel mode="invite" inviteToken={params.token} />
        </>
      )}
    </AuthCard>
  );
}
