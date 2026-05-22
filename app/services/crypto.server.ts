import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

export function encryptSecret(value: string): string {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const key = encryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptSecret(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted secret is malformed.");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptionKey(): Buffer {
  const source =
    process.env.ACCESS_TOKEN_ENCRYPTION_KEY ||
    process.env.SHOPIFY_API_SECRET ||
    "development-only-secret";
  return crypto.createHash("sha256").update(source).digest();
}
