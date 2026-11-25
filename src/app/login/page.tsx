import { AuthCard, AuthPanel } from "@/components/auth-panel";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <AuthCard title="Вход в LeadFlow" text="По коду на почту, через Telegram или паролем">
      <AuthPanel mode="login" allowRegister={process.env.ALLOW_REGISTRATION !== "false"} />
    </AuthCard>
  );
}
