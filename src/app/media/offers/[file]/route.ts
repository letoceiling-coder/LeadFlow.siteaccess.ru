import { readFile } from "fs/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (!/^[a-f0-9]{16}-[dm]\.png$/.test(file)) return new NextResponse("Не найдено", { status: 404 });
  try {
    const bytes = await readFile(`${process.env.OFFER_MEDIA_DIR || "/app/data/offers"}/${file}`);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("Не найдено", { status: 404 });
  }
}
