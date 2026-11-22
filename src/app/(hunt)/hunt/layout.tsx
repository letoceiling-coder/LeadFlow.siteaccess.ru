import type { ReactNode } from "react";
import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { HuntShell } from "@/components/hunt/shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Охота — LeadFlow" };

export default async function HuntLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <Suspense>
      <HuntShell user={{ name: session.name, role: session.role, tenantName: session.tenantName }}>{children}</HuntShell>
    </Suspense>
  );
}
