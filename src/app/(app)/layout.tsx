import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <Shell user={{ name: session.name, email: session.email, role: session.role, tenantId: session.tenantId, tenantName: session.tenantName }}>
      {children}
    </Shell>
  );
}
