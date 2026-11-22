"use client";

import { useEffect } from "react";
import { Button, State } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <State title="Раздел не открылся" text={error.message || "Обновите страницу. Если ошибка повторяется, проверьте журнал сервера."} action={<Button onClick={reset}>Повторить</Button>} />;
}
