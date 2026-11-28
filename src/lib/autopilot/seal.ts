// Sealing for Autopilot's per-user agent key (server only).
// The key is generated here, encrypted with AUTOPILOT_SEAL_KEY (AES-256-GCM)
// and handed to the browser only in sealed form. The browser cannot use it,
// the server keeps no copy, and a sealed blob is bound to its wallet.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.AUTOPILOT_SEAL_KEY;
  if (!raw) throw new AutopilotConfigError("AUTOPILOT_SEAL_KEY is not set");
  // 64 hex characters are used as-is; anything else is treated as a passphrase
  // (at least 32 characters) and stretched to a 32-byte key with SHA-256.
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  if (raw.length < 32) throw new AutopilotConfigError("AUTOPILOT_SEAL_KEY must be at least 32 characters");
  return createHash("sha256").update(`subscan-autopilot-v1:${raw}`).digest();
}

export class AutopilotConfigError extends Error {}

export function seal(payload: unknown, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
}

export function unseal<T>(sealed: string, aad: string): T {
  const [v, iv, ct, tag] = String(sealed).split(".");
  if (v !== "v1" || !iv || !ct || !tag) throw new Error("Unrecognised Autopilot access token");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8")) as T;
  } catch {
    throw new Error("Autopilot access token is invalid or was issued for another wallet");
  }
}
