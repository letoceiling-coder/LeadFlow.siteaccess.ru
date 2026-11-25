"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { ROLE_LABEL, formatDate } from "@/lib/domain/labels";

type Team = { members: { id: string; membershipId: string; name: string; email: string; role: string }[]; invitations: { id: string; email: string | null; role: string; expiresAt: string }[] };

export default function TeamPage() {
  const team = useResource<Team>("/api/team");
  const [invite, setInvite] = useState<{ email: string; path: string } | null>(null);
  const [error, setError] = useState("");
  if (team.loading) return <Loading />;
  if (team.error || !team.data) return <State title="Команда недоступна" text={team.error || "Нет ответа"} />;
  return (
    <div>
      <PageTitle title="Команда" text="Роль проверяется на сервере при каждом действии. Владельца этой страницей сменить нельзя. Код приглашения показывается один раз." />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          {team.data.members.map((member) => (
            <div key={member.membershipId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 text-sm">
              <div><div className="font-medium">{member.name}</div><div className="text-slate-500">{member.email}</div></div>
              {member.role === "OWNER" ? <span>{ROLE_LABEL.OWNER}</span> : (
                <div className="flex gap-2">
                  <select className={controlClass} value={member.role} onChange={(event) => api(`/api/team/${member.membershipId}`, { method: "PATCH", body: JSON.stringify({ role: event.target.value }) }).then(() => team.reload()).catch((reason) => setError(reason.message))}>
                    {["ADMIN", "MANAGER", "ANALYST", "OPERATOR", "VIEWER"].map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                  </select>
                  <Button variant="danger" onClick={() => { if (!window.confirm(`Убрать ${member.email} из пространства?`)) return; api(`/api/team/${member.membershipId}`, { method: "DELETE" }).then(() => team.reload()).catch((reason) => setError(reason.message)); }}>Убрать</Button>
                </div>
              )}
            </div>
          ))}
          <h2 className="mt-4 font-semibold">Ожидают принятия</h2>
          {team.data.invitations.length === 0 ? <p className="text-sm text-slate-500">Открытых приглашений нет</p> : team.data.invitations.map((item) => <p key={item.id} className="text-sm">{item.email ?? "любой по ссылке"} · {ROLE_LABEL[item.role]} · до {formatDate(item.expiresAt)}</p>)}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Пригласить</h2>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api<{ invitePath: string }>("/api/team/invitations", { method: "POST", body: JSON.stringify({ email: form.get("email"), role: form.get("role") }) }).then((row) => { setInvite({ email: String(form.get("email")), path: row.invitePath }); team.reload(); }).catch((reason) => setError(reason.message)); }}>
            <Field label="Email"><input name="email" type="email" required className={controlClass} /></Field>
            <Field label="Роль"><select name="role" className={controlClass}>{["MANAGER", "ANALYST", "OPERATOR", "VIEWER", "ADMIN"].map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}</select></Field>
            <Button type="submit">Создать приглашение</Button>
          </form>
          {invite ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">Ссылка для {invite.email}: <code className="break-all">{typeof window === "undefined" ? invite.path : `${window.location.origin}${invite.path}`}</code><p className="mt-1 text-xs">После закрытия страницы код снова не показывается.</p></div> : null}
        </Card>
      </div>
    </div>
  );
}
