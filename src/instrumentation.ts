export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.EMBED_WORKER === "1") {
    console.warn("Обработчик запускается отдельно: npm run worker или сервис worker. В процесс Next.js он не встраивается.");
  }
}
