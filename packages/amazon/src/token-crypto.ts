import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Thrown when a key is malformed or a sealed token can't be opened. It never carries the token. */
export class TokenCryptoError extends Error {
  override name = "TokenCryptoError";
}

/** A fresh key, base64, for AMAZON_TOKEN_ENCRYPTION_KEY. */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

/** A 32-byte AES key from its base64 form. */
export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES) throw new TokenCryptoError(`The token encryption key must be ${KEY_BYTES} bytes, base64-encoded.`);
  return key;
}

/** The key in AMAZON_TOKEN_ENCRYPTION_KEY. */
export function encryptionKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const value = env.AMAZON_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new TokenCryptoError("AMAZON_TOKEN_ENCRYPTION_KEY is not set.");
  return parseEncryptionKey(value);
}

/**
 * Seals a token with AES-256-GCM as "v1.<iv>.<tag>.<ciphertext>". `context` (the seller id) is
 * authenticated with it, so a sealed token copied onto another seller won't open.
 */
export function sealToken(token: string, key: Buffer, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

/** Opens what sealToken sealed with the same key and context. */
export function openToken(sealed: string, key: Buffer, context: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new TokenCryptoError("The sealed token is malformed.");
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenCryptoError("The sealed token could not be opened: wrong key, wrong seller, or tampered.");
  }
}
