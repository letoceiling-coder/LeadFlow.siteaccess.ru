import { redirect } from "next/navigation";

/** Старые ссылки вида /hunt/<id> и /hunt/search открывают нужную панель в новой ленте. */
export default async function LegacyHuntLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(id === "search" ? "/hunt?panel=search" : `/hunt?item=${encodeURIComponent(id)}`);
}
