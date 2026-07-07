/**
 * Credential encryption / decryption using AES-256-GCM.
 *
 * Plaintext passwords are NEVER stored or logged.
 * The encryption key is derived from AUTOMATION_SECRET env var.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT = "job-ops-automation-v1";

function deriveKey(): Buffer {
  const secret = process.env.AUTOMATION_SECRET ?? "job-ops-default-automation-secret-change-me";
  return scryptSync(secret, SALT, KEY_LEN);
}

export function encryptPassword(plaintext: string): {
  encryptedPassword: string;
  iv: string;
  authTag: string;
} {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedPassword: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptPassword(params: {
  encryptedPassword: string;
  iv: string;
  authTag: string;
}): string {
  const key = deriveKey();
  const iv = Buffer.from(params.iv, "hex");
  const authTag = Buffer.from(params.authTag, "hex");
  const encrypted = Buffer.from(params.encryptedPassword, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}
