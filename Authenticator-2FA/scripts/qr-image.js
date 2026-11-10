/**
 * Decodifica QR Code de uma imagem local.
 * Usa BarcodeDetector e/ou jsQR local quando disponível; não envia imagem nem segredo para rede.
 * Tenta reduzir imagens grandes, melhorar contraste e corrigir rotações comuns.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 8000;
const MAX_PIXELS = 32_000_000;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function makeCanvas(environment, bitmap, { rotation = 0, scale = 1, contrast = false } = {}) {
  const sideways = rotation === 90 || rotation === 270;
  const width = Math.max(1, Math.round((sideways ? bitmap.height : bitmap.width) * scale));
  const height = Math.max(1, Math.round((sideways ? bitmap.width : bitmap.height) * scale));
  const canvas = environment.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Não foi possível processar a imagem neste navegador.");
  context.save?.();
  context.translate(width / 2, height / 2);
  context.rotate(rotation * Math.PI / 180);
  context.drawImage(bitmap, -bitmap.width * scale / 2, -bitmap.height * scale / 2, bitmap.width * scale, bitmap.height * scale);
  context.restore?.();
  if (contrast && context.getImageData && context.putImageData) {
    const frame = context.getImageData(0, 0, width, height);
    const pixels = frame.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      const value = gray < 128 ? 0 : 255;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
    }
    context.putImageData(frame, 0, 0);
  }
  return canvas;
}

export async function decodeQrFromImage(file, environment = globalThis) {
  if (!file || typeof file.size !== "number") throw new Error("Selecione uma imagem válida.");
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error("A imagem deve ter até 10 MB.");
  if (file.type && !ACCEPTED_TYPES.has(file.type.toLowerCase())) throw new Error("Formato não suportado. Selecione uma imagem PNG, JPG ou WEBP.");
  if (!environment.createImageBitmap || !environment.document?.createElement) {
    throw new Error("Este navegador não oferece processamento local de imagens. Use a URI otpauth:// ou a chave fornecida pelo serviço.");
  }
  const nativeAvailable = typeof environment.BarcodeDetector === "function";
  const jsQrAvailable = typeof environment.jsQR === "function";
  if (!nativeAvailable && !jsQrAvailable) {
    throw new Error("Não há decoder QR local disponível neste pacote. Use a URI otpauth:// ou a chave fornecida pelo serviço.");
  }

  let bitmap;
  try {
    bitmap = await environment.createImageBitmap(file);
    if (!bitmap.width || !bitmap.height || bitmap.width > MAX_DIMENSION || bitmap.height > MAX_DIMENSION || bitmap.width * bitmap.height > MAX_PIXELS) {
      throw new Error("A imagem possui dimensões muito grandes. O limite é 8000 × 8000 pixels e 32 megapixels.");
    }
    const detector = nativeAvailable ? new environment.BarcodeDetector({ formats: ["qr_code"] }) : null;
    const attempts = [bitmap];
    const maxSide = Math.max(bitmap.width, bitmap.height);
    if (maxSide > 1800) attempts.push(makeCanvas(environment, bitmap, { scale: 1800 / maxSide }));
    // Imagens pequenas podem conter QR Codes minúsculos; ampliar ajuda alguns detectores.
    if (maxSide < 900) attempts.push(makeCanvas(environment, bitmap, { scale: Math.min(2, 900 / maxSide) }));
    for (const rotation of [90, 180, 270]) attempts.push(makeCanvas(environment, bitmap, { rotation }));
    // Última tentativa binariza a imagem para reduzir problemas de iluminação/contraste.
    attempts.push(makeCanvas(environment, bitmap, { scale: maxSide > 1800 ? 1800 / maxSide : 1, contrast: true }));

    for (const source of attempts) {
      if (detector) {
        const codes = await detector.detect(source);
        const value = codes.find((code) => typeof code.rawValue === "string" && code.rawValue.trim())?.rawValue;
        if (value) return value.trim();
      }
      if (jsQrAvailable) {
        const canvas = source.getContext ? source : makeCanvas(environment, source, {});
        const context = canvas.getContext("2d", { willReadFrequently: true });
        const frame = context?.getImageData(0, 0, canvas.width, canvas.height);
        if (frame) {
          const decoded = environment.jsQR(frame.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
          if (decoded?.data?.trim()) return decoded.data.trim();
        }
      }
    }
    throw new Error("Nenhum QR Code foi encontrado. Use uma imagem completa, nítida e sem reflexos, ou cole a URI otpauth://.");
  } catch (error) {
    if (error instanceof Error && /^(A imagem|Formato|Selecione|Este navegador|Nenhum QR|Não foi possível)/.test(error.message)) throw error;
    throw new Error("Não foi possível processar essa imagem. Tente PNG/JPG/WEBP, uma captura mais nítida ou cole a URI otpauth://.");
  } finally {
    bitmap?.close?.();
  }
}
