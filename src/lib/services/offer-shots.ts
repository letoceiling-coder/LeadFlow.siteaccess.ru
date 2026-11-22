import "server-only";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { access, mkdir, stat, unlink } from "fs/promises";
import { promisify } from "util";

const exec = promisify(execFile);
const BINS = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];

function mediaDir() {
  return process.env.OFFER_MEDIA_DIR || "/app/data/offers";
}

function publicBase() {
  return (process.env.APP_URL || "https://leadflow.siteaccess.ru").replace(/\/$/, "");
}

async function bin() {
  for (const path of BINS) {
    try {
      await access(path);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

async function shoot(command: string, pageUrl: string, width: number, height: number, suffix: string) {
  const dir = mediaDir();
  await mkdir(dir, { recursive: true });
  const name = `${createHash("sha256").update(`${pageUrl}|${width}x${height}`).digest("hex").slice(0, 16)}-${suffix}.png`;
  const file = `${dir}/${name}`;
  try {
    const existing = await stat(file);
    if (existing.size > 8000) return name;
  } catch {
    /* снимаем заново */
  }
  await exec(
    command,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      "--virtual-time-budget=12000",
      `--screenshot=${file}`,
      pageUrl,
    ],
    { timeout: 25000 },
  );
  const ready = await stat(file);
  if (ready.size < 8000) {
    await unlink(file).catch(() => undefined);
    return null;
  }
  return name;
}

export async function captureOfferShots(pageUrl: string): Promise<{ desktop: string | null; mobile: string | null }> {
  if (!/^https:\/\/\S+$/i.test(pageUrl)) return { desktop: null, mobile: null };
  const command = await bin();
  if (!command) return { desktop: null, mobile: null };
  const base = publicBase();
  const desktop = await shoot(command, pageUrl, 1280, 800, "d").catch(() => null);
  const mobile = await shoot(command, pageUrl, 390, 844, "m").catch(() => null);
  return {
    desktop: desktop ? `${base}/media/offers/${desktop}` : null,
    mobile: mobile ? `${base}/media/offers/${mobile}` : null,
  };
}
