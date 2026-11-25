/** Сообщение клиенту со ссылкой на опубликованный демо-сайт (и КП, если оно уже собрано). Без запрещённых фраз из pitch.ts. */
export function demoMessage(input: { name: string; demoUrl: string; proposalUrl: string | null }) {
  return [
    `Собрал демо сайта для «${input.name}» — на ваших данных с карт, открывается с телефона:`,
    input.demoUrl,
    input.proposalUrl ? `Варианты и цены — здесь:\n${input.proposalUrl}` : null,
    "Это черновик: тексты, цвета и блоки поменяю под вас. Что откликается, а что убрать?",
  ]
    .filter(Boolean)
    .join("\n\n");
}
