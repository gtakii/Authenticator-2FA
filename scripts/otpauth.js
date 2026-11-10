import { normalizeSecret } from "./totp.js";

const SUPPORTED_ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);
const ALLOWED_PARAMETERS = new Set(["secret", "issuer", "algorithm", "digits", "period"]);

export function parseOtpAuthUri(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("URI inválida ou muito longa.");
  const input = value.trim();
  if (!/^otpauth:\/\/[a-z]+\//i.test(input) || /\s/.test(input) || /%(?![0-9a-f]{2})/i.test(input)) throw new Error("Cole a URI completa otpauth://totp/... copiada da configuração 2FA. Links comuns e textos soltos não são aceitos.");
  let url;
  try { url = new URL(input); } catch { throw new Error("URI inválida. Use otpauth://totp/..."); }
  if (url.protocol !== "otpauth:" || url.hostname.toLowerCase() !== "totp" || url.username || url.password || url.hash || url.port) throw new Error("Formato não suportado. Importe uma URI otpauth://totp.");

  for (const key of url.searchParams.keys()) {
    if (key !== key.toLowerCase() || !ALLOWED_PARAMETERS.has(key)) throw new Error("A URI contém parâmetros não suportados.");
    if (url.searchParams.getAll(key).length !== 1) throw new Error(`Parâmetro duplicado na URI: ${key}.`);
  }

  const secret = normalizeSecret(url.searchParams.get("secret") || "");
  const algorithm = (url.searchParams.get("algorithm") || "SHA1").toUpperCase().replace("-", "");
  const digits = Number(url.searchParams.get("digits") || 6);
  const period = Number(url.searchParams.get("period") || 30);
  if (!SUPPORTED_ALGORITHMS.has(algorithm)) throw new Error("Algoritmo TOTP não suportado.");
  if (![6, 7, 8].includes(digits)) throw new Error("Quantidade de dígitos TOTP inválida.");
  if (!Number.isInteger(period) || period < 1 || period > 300) throw new Error("Período TOTP inválido (1 a 300 segundos).");

  let label;
  try { label = decodeURIComponent(url.pathname.replace(/^\//, "")); }
  catch { throw new Error("Identificador da URI contém codificação inválida."); }
  const separator = label.indexOf(":");
  const labelIssuer = separator >= 0 ? label.slice(0, separator) : "";
  const account = separator >= 0 ? label.slice(separator + 1) : label;
  const issuerValue = url.searchParams.get("issuer");
  if (issuerValue !== null && !issuerValue.trim()) throw new Error("O emissor da URI está vazio.");
  if (issuerValue && labelIssuer && issuerValue.trim() !== labelIssuer.trim()) throw new Error("O emissor na URI não corresponde ao emissor do identificador.");
  const issuer = (issuerValue || labelIssuer || "").trim();
  if (!issuer || issuer.length > 60 || !account.trim() || account.length > 120) throw new Error("A URI precisa identificar o serviço e a conta, com nomes de até 60 e 120 caracteres.");
  return { secret, issuer, account, options: { algorithm, digits, period } };
}

export function buildOtpAuthUri(item) {
  const issuer = String(item.issuer || "").trim();
  const account = String(item.account || "");
  if (!issuer || issuer.length > 60 || account.length > 120) throw new Error("Identificação da conta inválida.");
  const secret = normalizeSecret(item.secret);
  const algorithm = String(item.algorithm || "SHA1").toUpperCase();
  const digits = item.digits || 6;
  const period = item.period || 30;
  if (!SUPPORTED_ALGORITHMS.has(algorithm) || ![6, 7, 8].includes(digits) || !Number.isInteger(period) || period < 1 || period > 300) throw new Error("Parâmetros TOTP inválidos para gerar o QR Code.");
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({ secret, issuer, algorithm, digits: String(digits), period: String(period) });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}


/** Valida configuração manual usando a chave TOTP explicitamente fornecida pelo serviço. */
export function parseManualOtpAuthConfig({ issuer, account = "", secret, algorithm = "SHA1", digits = 6, period = 30 }) {
  const cleanIssuer = typeof issuer === "string" ? issuer.trim() : "";
  const cleanAccount = typeof account === "string" ? account.trim() : "";
  if (!cleanIssuer || cleanIssuer.length > 60) throw new Error("Informe o nome do serviço (até 60 caracteres). ");
  if (cleanAccount.length > 120) throw new Error("A identificação da conta deve ter até 120 caracteres.");
  const cleanSecret = normalizeSecret(secret);
  const cleanAlgorithm = String(algorithm).toUpperCase().replace("-", "");
  const cleanDigits = Number(digits);
  const cleanPeriod = Number(period);
  if (!SUPPORTED_ALGORITHMS.has(cleanAlgorithm)) throw new Error("Algoritmo TOTP não suportado.");
  if (![6, 7, 8].includes(cleanDigits)) throw new Error("Quantidade de dígitos TOTP inválida.");
  if (!Number.isInteger(cleanPeriod) || cleanPeriod < 1 || cleanPeriod > 300) throw new Error("Período TOTP inválido.");
  return { secret: cleanSecret, issuer: cleanIssuer, account: cleanAccount, options: { algorithm: cleanAlgorithm, digits: cleanDigits, period: cleanPeriod } };
}
