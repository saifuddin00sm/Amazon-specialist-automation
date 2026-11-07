import { describe, expect, it } from "vitest";
import { createMemoryRefreshTokenStore, createRefreshTokenVault, MissingRefreshTokenError } from "./refresh-tokens";
import { encryptionKeyFromEnv, generateEncryptionKey, openToken, parseEncryptionKey, sealToken, TokenCryptoError } from "./token-crypto";

const key = parseEncryptionKey(generateEncryptionKey());
const token = "Atzr|IwEBIExampleRefreshToken";

describe("token encryption", () => {
  it("seals and opens a token for the same seller", () => {
    const sealed = sealToken(token, key, "A1SELLER000001");
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain("Atzr");
    expect(openToken(sealed, key, "A1SELLER000001")).toBe(token);
  });

  it("seals the same token differently every time", () => {
    expect(sealToken(token, key, "A1SELLER000001")).not.toBe(sealToken(token, key, "A1SELLER000001"));
  });

  it("won't open with another seller, another key, or after tampering", () => {
    const sealed = sealToken(token, key, "A1SELLER000001");
    expect(() => openToken(sealed, key, "A1SELLER000002")).toThrow(TokenCryptoError);
    expect(() => openToken(sealed, parseEncryptionKey(generateEncryptionKey()), "A1SELLER000001")).toThrow(TokenCryptoError);
    const [version, iv, tag, ciphertext] = sealed.split(".");
    const flipped = `${ciphertext!.startsWith("A") ? "B" : "A"}${ciphertext!.slice(1)}`;
    expect(() => openToken([version, iv, tag, flipped].join("."), key, "A1SELLER000001")).toThrow(TokenCryptoError);
    expect(() => openToken("not-a-sealed-token", key, "A1SELLER000001")).toThrow(TokenCryptoError);
  });

  it("never puts the token in an error", () => {
    const sealed = sealToken(token, key, "A1SELLER000001");
    try {
      openToken(sealed, key, "A1SELLER000002");
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });

  it("insists on a 32-byte key", () => {
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrow(TokenCryptoError);
    expect(() => encryptionKeyFromEnv({})).toThrow("AMAZON_TOKEN_ENCRYPTION_KEY is not set.");
    expect(encryptionKeyFromEnv({ AMAZON_TOKEN_ENCRYPTION_KEY: key.toString("base64") })).toEqual(key);
  });
});

describe("refresh token vault", () => {
  it("keeps only sealed tokens in the store", async () => {
    const store = createMemoryRefreshTokenStore();
    const vault = createRefreshTokenVault(store, key);
    await vault.save("A1SELLER000001", token);
    const atRest = await store.get("A1SELLER000001");
    expect(atRest).toBeDefined();
    expect(atRest).not.toContain(token);
    expect(await vault.load("A1SELLER000001")).toBe(token);
  });

  it("says so when a seller has no token", async () => {
    const vault = createRefreshTokenVault(createMemoryRefreshTokenStore(), key);
    await expect(vault.load("A1SELLER000001")).rejects.toThrow(MissingRefreshTokenError);
  });
});
