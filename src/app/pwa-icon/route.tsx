import { ImageResponse } from "next/og";

export const runtime = "edge";

/** PNG-иконка для установки на телефон: 180 (iOS), 192, 512 и maskable. */
export function GET(request: Request) {
  const url = new URL(request.url);
  const size = [180, 192, 512].includes(Number(url.searchParams.get("size"))) ? Number(url.searchParams.get("size")) : 192;
  const maskable = url.searchParams.get("maskable") === "1";
  const inner = maskable ? size * 0.62 : size;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0b0d" }}>
        <div style={{ width: inner, height: inner, display: "flex", alignItems: "center", justifyContent: "center", color: "#ffd60a", fontSize: inner * 0.42, fontWeight: 700, letterSpacing: -inner * 0.02 }}>LF</div>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=604800, immutable" } },
  );
}
