// Criptografia do cofre e dos backups. Usa apenas Web Crypto API.
export const KDF_ITERATIONS = 310_000;
const VAULT_VERSION = 2;
const encoder = new TextEncoder();

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value) {
  if (typeof value !== "string" || value.length > 20_000_000) throw new Error("Dado criptografado inválido.");
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function deriveEncryptionKey(password, salt) {
  if (typeof password !== "string" || password.length < 10) throw new Error("A senha principal deve ter pelo menos 10 caracteres.");
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

export async function encryptVaultWithKey(key, data, saltBase64) {
  const salt = fromBase64(saltBase64);
  if (salt.length !== 16) throw new Error("Salt do cofre inválido.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = encoder.encode(`Authenticator2FA:v${VAULT_VERSION}`);
  const plaintext = encoder.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData, tagLength: 128 }, key, plaintext);
  return { version: VAULT_VERSION, kdf: "PBKDF2-SHA-256", iterations: KDF_ITERATIONS, cipher: "AES-256-GCM", salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export async function createEncryptedVault(password, accounts) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveEncryptionKey(password, salt);
  return { key, payload: await encryptVaultWithKey(key, accounts, toBase64(salt)) };
}

export async function decryptVault(password, payload) {
  if (!payload || typeof payload !== "object") throw new Error("Cofre inválido.");
  const salt = fromBase64(payload.salt), iv = fromBase64(payload.iv), ciphertext = fromBase64(payload.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error("Cofre inválido ou incompleto.");
  const key = await deriveEncryptionKey(password, salt);
  let plaintext;
  if (payload.version === undefined) {
    // Compatibilidade com o formato 1.1.0: AES-GCM sem AAD e sem metadados de versão.
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, ciphertext);
  } else {
    if (payload.version !== VAULT_VERSION || payload.kdf !== "PBKDF2-SHA-256" || payload.cipher !== "AES-256-GCM" || payload.iterations !== KDF_ITERATIONS) throw new Error("Formato ou versão do cofre não suportado.");
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`Authenticator2FA:v${VAULT_VERSION}`), tagLength: 128 }, key, ciphertext);
  }
  return { key, accounts: JSON.parse(new TextDecoder().decode(plaintext)), legacy: payload.version === undefined, salt: payload.salt };
}

export async function encryptWithPassword(password, data, purpose = "backup") {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveEncryptionKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = encoder.encode(`Authenticator2FA:${purpose}:v1`);
  const plaintext = encoder.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData, tagLength: 128 }, key, plaintext);
  return { format: "authenticator-2fa-encrypted", version: 1, purpose, kdf: "PBKDF2-SHA-256", iterations: KDF_ITERATIONS, cipher: "AES-256-GCM", salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export async function decryptWithPassword(password, payload, expectedPurpose = "backup") {
  if (!payload || payload.format !== "authenticator-2fa-encrypted" || payload.version !== 1 || payload.purpose !== expectedPurpose || payload.kdf !== "PBKDF2-SHA-256" || payload.cipher !== "AES-256-GCM" || payload.iterations !== KDF_ITERATIONS) throw new Error("Arquivo de backup inválido ou incompatível.");
  const salt = fromBase64(payload.salt), iv = fromBase64(payload.iv), ciphertext = fromBase64(payload.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error("Arquivo criptografado incompleto.");
  const key = await deriveEncryptionKey(password, salt);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`Authenticator2FA:${expectedPurpose}:v1`), tagLength: 128 }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}
