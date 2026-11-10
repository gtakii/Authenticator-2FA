// TOTP conforme RFC 6238, com parâmetros por conta e padrões compatíveis.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);

export function normalizeSecret(input) {
  if (typeof input !== "string") throw new Error("Informe a chave secreta fornecida pelo serviço.");
  // Espaços são comuns quando o serviço apresenta a chave em grupos.
  // Padding Base32, quando presente, só pode aparecer no final e deve ser canônico.
  const raw = input.toUpperCase().replace(/[\s-]/g, "");
  if (!raw || raw.length > 134 || !/^[A-Z2-7]+={0,6}$/.test(raw)) {
    throw new Error("Chave inválida. Use a chave Base32 apresentada pelo serviço (A-Z e 2-7). Não cole uma senha ou código de 2FA.");
  }
  const secret = raw.replace(/=+$/, "");
  const remainder = secret.length % 8;
  const validRemainders = new Set([0, 2, 4, 5, 7]);
  if (!validRemainders.has(remainder)) throw new Error("Comprimento Base32 inválido. Confira a chave fornecida pelo serviço.");
  const expectedPadding = ({ 0: 0, 2: 6, 4: 4, 5: 3, 7: 1 })[remainder];
  const suppliedPadding = raw.length - secret.length;
  if (suppliedPadding && suppliedPadding !== expectedPadding) throw new Error("Preenchimento Base32 inválido. Copie novamente a chave fornecida pelo serviço.");
  const bytes = base32ToBytes(secret);
  if (bytes.length < 10) throw new Error("A chave é curta demais para um segredo TOTP aceitável. Solicite ao serviço uma nova chave de configuração.");
  if (bytes.length > 80) throw new Error("A chave é maior que o limite suportado.");
  // Recusa segredos obviamente fracos (repetições simples), sem alegar que
  // consegue provar a origem: uma chave Base32 aleatória válida é indistinguível
  // de uma chave emitida por um serviço quando inserida manualmente.
  if (new Set(bytes).size < 5) throw new Error("A chave tem pouca variedade e parece inválida. Gere uma nova chave no serviço que oferece o 2FA.");
  for (let size = 1; size <= 4; size++) {
    if (bytes.length % size === 0 && bytes.every((value, index) => value === bytes[index % size])) {
      throw new Error("A chave parece ser um padrão repetido, não um segredo TOTP fornecido por um serviço.");
    }
  }
  return secret;
}

export function base32ToBytes(base32) {
  if (typeof base32 !== "string" || !base32.length || base32.length > 128 || !/^[A-Z2-7]+$/.test(base32) || ![0, 2, 4, 5, 7].includes(base32.length % 8)) throw new Error("Chave Base32 inválida.");
  let accumulator = 0, bits = 0;
  const bytes = [];
  for (const char of base32) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) throw new Error("Caractere Base32 inválido.");
    accumulator = (accumulator << 5) | value;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((accumulator >>> bits) & 0xff); }
  }
  if (bits && (accumulator & ((1 << bits) - 1)) !== 0) throw new Error("Chave Base32 com preenchimento inválido.");
  return new Uint8Array(bytes);
}

export async function generateTOTP(secret, timestamp = Date.now(), options = {}) {
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error("Horário inválido para gerar o código.");
  const algorithm = String(options.algorithm || "SHA1").toUpperCase().replace("-", "");
  const digits = options.digits ?? 6;
  const period = options.period ?? 30;
  if (!ALGORITHMS.has(algorithm)) throw new Error("Algoritmo TOTP não suportado.");
  if (![6, 7, 8].includes(digits)) throw new Error("A quantidade de dígitos TOTP deve ser 6, 7 ou 8.");
  if (!Number.isInteger(period) || period < 1 || period > 300) throw new Error("Período TOTP inválido.");
  const keyBytes = base32ToBytes(normalizeSecret(secret));
  const counter = Math.floor(timestamp / (period * 1000));
  const message = new ArrayBuffer(8), view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 0x1_0000_0000), false);
  view.setUint32(4, counter >>> 0, false);
  const hash = algorithm === "SHA1" ? "SHA-1" : algorithm === "SHA256" ? "SHA-256" : "SHA-512";
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24) | ((signature[offset + 1] & 0xff) << 16) | ((signature[offset + 2] & 0xff) << 8) | (signature[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, "0");
}
