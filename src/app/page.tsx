import { redirect } from "next/navigation";

/** Главная — сразу «Охота»: это основной ежедневный экран. Обзор полной версии — /overview. */
export default function Home() {
  redirect("/hunt");
}
