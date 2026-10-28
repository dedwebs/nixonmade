import type { ProductSlug } from "./products";
import { isProductSlug } from "./products";

export const SESSION_ID_RE = /^cs_(test_|live_)[A-Za-z0-9]{8,200}$/;
export const PAYMENT_INTENT_RE = /^pi_[A-Za-z0-9]{8,200}$/;

const JTI_RE = /^[A-Za-z0-9_-]{16,64}$/;
const encoder = new TextEncoder();

export type DownloadToken = {
  v: 1;
  exp: number;
  jti: string;
  product: ProductSlug;
  sid: string;
};

/**
 * Fixed-length MAC compare. The length check is not secret (SHA-256 is 32
 * bytes). The XOR loop always walks every byte and does not return early.
 */
export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    const a = i < left.length ? left[i]! : 0;
    const b = i < right.length ? right[i]! : 0;
    mismatch |= a ^ b;
  }
  return mismatch === 0;
}

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64urlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(mac);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const bytes = await hmacSha256(secret, message);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function newJti(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

export function signingSecretOk(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

export async function signDownloadToken(
  token: DownloadToken,
  secret: string,
): Promise<string> {
  const body = base64urlEncode(encoder.encode(JSON.stringify(token)));
  const mac = await hmacSha256(secret, body);
  return `${body}.${base64urlEncode(mac)}`;
}

export async function verifyDownloadToken(
  token: string,
  secret: string,
  nowMs: number,
): Promise<DownloadToken | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const body = parts[0] ?? "";
  const macPart = parts[1] ?? "";
  const actual = base64urlDecode(macPart);
  const expected = await hmacSha256(secret, body);
  const actualBytes = actual ?? new Uint8Array(expected.length);
  if (!timingSafeEqual(actualBytes, expected) || actual === null) return null;

  let parsed: unknown;
  try {
    const decoded = base64urlDecode(body);
    if (!decoded) return null;
    parsed = JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (typeof record.exp !== "number" || !Number.isFinite(record.exp)) return null;
  if (record.exp * 1000 <= nowMs) return null;
  if (typeof record.jti !== "string" || !JTI_RE.test(record.jti)) return null;
  if (typeof record.sid !== "string" || !SESSION_ID_RE.test(record.sid)) return null;
  if (!isProductSlug(record.product)) return null;
  return {
    v: 1,
    exp: record.exp,
    jti: record.jti,
    product: record.product,
    sid: record.sid,
  };
}

export function sessionMode(sessionId: string): "test" | "live" | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  if (sessionId.startsWith("cs_test_")) return "test";
  if (sessionId.startsWith("cs_live_")) return "live";
  return null;
}
