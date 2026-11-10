import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeQrFromImage } from '../scripts/qr-image.js';

function envFor(detect) {
  const context = { drawImage() {}, translate() {}, rotate() {} };
  return {
    async createImageBitmap() { return { width: 640, height: 480, close() {} }; },
    BarcodeDetector: class { async detect(source) { return detect(source); } },
    document: { createElement() { return { width: 0, height: 0, getContext() { return context; } }; } }
  };
}

test('decodes a QR locally and returns its raw content', async () => {
  const raw = 'otpauth://totp/Example:user?secret=JBSWY3DPEHPK3PXP&issuer=Example';
  const result = await decodeQrFromImage({ size: 100, type: 'image/png' }, envFor(() => [{ rawValue: raw }]));
  assert.equal(result, raw);
});

test('tries rotated image variants before reporting no QR', async () => {
  let attempts = 0;
  const env = envFor(() => (++attempts === 4 ? [{ rawValue: 'otpauth://totp/x' }] : []));
  const result = await decodeQrFromImage({ size: 100 }, env);
  assert.equal(result, 'otpauth://totp/x');
  assert.equal(attempts, 4);
});

test('rejects oversized images before decoding', async () => {
  await assert.rejects(() => decodeQrFromImage({ size: 11 * 1024 * 1024 }, envFor(() => [])), /10 MB/);
});

test('reports missing browser decoder clearly', async () => {
  await assert.rejects(() => decodeQrFromImage({ size: 100 }, {}), /não oferece processamento|não há decoder/i);
});

test('reports images without QR codes', async () => {
  await assert.rejects(() => decodeQrFromImage({ size: 100 }, envFor(() => [])), /Nenhum QR Code/);
});

test('rejects unsupported image MIME types', async () => {
  await assert.rejects(() => decodeQrFromImage({ size: 100, type: 'image/gif' }, envFor(() => [])), /PNG, JPG ou WEBP/);
});

test('closes image bitmap after successful decoding', async () => {
  let closed = false;
  const env = envFor(() => [{ rawValue: 'otpauth://totp/demo?secret=JBSWY3DPEHPK3PXP' }]);
  env.createImageBitmap = async () => ({ width: 640, height: 480, close() { closed = true; } });
  await decodeQrFromImage({ size: 100, type: 'image/png' }, env);
  assert.equal(closed, true);
});


test('uses the local jsQR adapter when BarcodeDetector is unavailable', async () => {
  const raw = 'otpauth://totp/Local:user?secret=JBSWY3DPEHPK3PXP';
  const context = {
    drawImage() {}, translate() {}, rotate() {}, save() {}, restore() {},
    getImageData() { return { data: new Uint8ClampedArray(640 * 480 * 4) }; }
  };
  const env = {
    async createImageBitmap() { return { width: 640, height: 480, close() {} }; },
    jsQR() { return { data: raw }; },
    document: { createElement() { return { width: 640, height: 480, getContext() { return context; } }; } }
  };
  assert.equal(await decodeQrFromImage({ size: 100, type: 'image/png' }, env), raw);
});
