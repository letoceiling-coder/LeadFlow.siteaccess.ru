import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { ApiError } from "./errors";

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? "";
  if (raw.length < 32) {
    throw new ApiError(
      503,
      "Секреты нельзя сохранить: задайте ENCRYPTION_KEY длиной от 32 символов только на сервере.",
      "encryption_unconfigured",
    );
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function optOutSecret(): string {
  return createHmac("sha256", encryptionKey()).update("leadflow-opt-out").digest("hex");
}
