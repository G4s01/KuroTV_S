/**
 * Web Crypto utilities for KuroTV_S
 * Pure Web Crypto APIs (crypto.subtle, crypto.getRandomValues)
 * Zero Node dependencies, compatible with Cloudflare Workers runtime
 */

export const PAIRING_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string length: must be even");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex character at position ${i}`);
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return bytesToHex(new Uint8Array(digest));
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export function generateSalt(byteLength = 16): Uint8Array {
  const salt = new Uint8Array(byteLength);
  crypto.getRandomValues(salt);
  return salt;
}

export interface HashPasswordResult {
  hash: string;
  salt: string;
}

/**
 * PBKDF2 hash derivation with SHA-256 and 100,000 iterations.
 * Uses 16-byte random salt if saltHex is omitted.
 */
export async function hashPassword(
  password: string,
  saltHex?: string | Uint8Array
): Promise<HashPasswordResult> {
  let saltBytes: Uint8Array;
  let activeSaltHex: string;

  if (!saltHex) {
    saltBytes = generateSalt(16);
    activeSaltHex = bytesToHex(saltBytes);
  } else if (typeof saltHex === "string") {
    saltBytes = hexToBytes(saltHex);
    activeSaltHex = saltHex;
  } else {
    saltBytes = saltHex;
    activeSaltHex = bytesToHex(saltBytes);
  }

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes as any,
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: activeSaltHex,
  };
}

/**
 * Constant-time comparison using crypto.subtle.timingSafeEqual
 * Normalizes inputs to 32-byte SHA-256 digests to prevent timing leaks
 * on both equal and non-equal length strings.
 */
export async function timingSafeEqual(
  a: string | Uint8Array,
  b: string | Uint8Array
): Promise<boolean> {
  const bytesA = typeof a === "string" ? new TextEncoder().encode(a) : a;
  const bytesB = typeof b === "string" ? new TextEncoder().encode(b) : b;

  const copyA = new Uint8Array(bytesA.byteLength);
  copyA.set(bytesA);
  const copyB = new Uint8Array(bytesB.byteLength);
  copyB.set(bytesB);

  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", copyA.buffer),
    crypto.subtle.digest("SHA-256", copyB.buffer),
  ]);

  if (typeof (crypto.subtle as any)?.timingSafeEqual === "function") {
    return (crypto.subtle as any).timingSafeEqual(digestA, digestB);
  }

  // Fallback constant-time XOR comparison over fixed 32-byte SHA-256 digests
  const arrA = new Uint8Array(digestA);
  const arrB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= arrA[i] ^ arrB[i];
  }
  return diff === 0;
}

export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  return timingSafeEqual(a, b);
}

/**
 * Verify password against stored hash and salt using timing-safe comparison.
 * Flexible parameter ordering supports both (password, expectedHash, saltHex)
 * and (password, saltHex, expectedHash).
 */
export async function verifyPassword(
  password: string,
  arg2: string,
  arg3: string
): Promise<boolean> {
  try {
    let expectedHash: string;
    let saltHex: string;
    if (arg2.length === 64) {
      expectedHash = arg2;
      saltHex = arg3;
    } else if (arg3.length === 64) {
      saltHex = arg2;
      expectedHash = arg3;
    } else {
      expectedHash = arg2;
      saltHex = arg3;
    }

    const { hash } = await hashPassword(password, saltHex);
    return timingSafeEqualStrings(hash, expectedHash);
  } catch {
    return false;
  }
}

/**
 * Generate cryptographically secure 256-bit token with optional prefix.
 */
export function generateToken(prefix = ""): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}${bytesToHex(bytes)}`;
}

export function generateDeviceToken(): string {
  return generateToken("kuro_dev_");
}

export function generateSessionToken(): string {
  return generateToken("kuro_sess_");
}

export function generateRandomToken(prefix = "kuro_tok_", byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return `${prefix}${bytesToHex(bytes)}`;
}

/**
 * 6-character alphanumeric pairing code from unambiguous charset:
 * ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (excludes 0, O, 1, I).
 * Uses bitwise masking (bytes[i] & 31) for zero modulo bias (256 % 32 = 0).
 */
export function generatePairingCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += PAIRING_CODE_CHARSET[bytes[i] & 31];
  }
  return code;
}
