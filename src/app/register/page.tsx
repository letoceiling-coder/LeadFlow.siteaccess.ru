import { redirect } from "next/navigation";
import { AuthCard, AuthPanel } from "@/components/auth-panel";

// Значение ALLOW_REGISTRATION приходит из .env при запуске, а не при сборке.
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  if (process.env.ALLOW_REGISTRATION === "false") redirect("/login");
  return (
    <AuthCard title="Регистрация" text="Подтвердите почту или Telegram — администратор откроет доступ">
      <AuthPanel mode="register" />
    </AuthCard>
  );
}
