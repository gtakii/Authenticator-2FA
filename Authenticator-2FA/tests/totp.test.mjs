import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTOTP, normalizeSecret } from '../scripts/totp.js';

test('RFC 6238: vetores HMAC-SHA1 de 6 dígitos', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const vectors = [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']];
  for (const [seconds, expected] of vectors) assert.equal(await generateTOTP(secret, seconds * 1000), expected);
});

test('normalização Base32 rejeita segredo curto e caracteres inválidos', () => {
  assert.throws(() => normalizeSecret('ABC'), /inválido|curta demais/);
  assert.throws(() => normalizeSecret('JBSWY3DP!'), /Base32/);
  assert.equal(normalizeSecret(' gezd gnbv gy3t qojq gezd gnbv gy3t qojq '), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});


test('RFC 6238: vetores HMAC-SHA256 e HMAC-SHA512', async () => {
  const sha256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
  const sha512 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';
  const vectors256 = [[59,'46119246'],[1111111109,'68084774'],[1111111111,'67062674'],[1234567890,'91819424'],[2000000000,'90698825'],[20000000000,'77737706']];
  const vectors512 = [[59,'90693936'],[1111111109,'25091201'],[1111111111,'99943326'],[1234567890,'93441116'],[2000000000,'38618901'],[20000000000,'47863826']];
  for (const [seconds, expected] of vectors256) assert.equal(await generateTOTP(sha256, seconds * 1000, { algorithm: 'SHA256', digits: 8 }), expected);
  for (const [seconds, expected] of vectors512) assert.equal(await generateTOTP(sha512, seconds * 1000, { algorithm: 'SHA512', digits: 8 }), expected);
});

test('Parâmetros TOTP alternativos são validados', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal((await generateTOTP(secret, 60000, { digits: 8, period: 60 })).length, 8);
  await assert.rejects(() => generateTOTP(secret, Date.now(), { algorithm: 'MD5' }));
  await assert.rejects(() => generateTOTP(secret, Date.now(), { digits: 9 }));
  await assert.rejects(() => generateTOTP(secret, Date.now(), { period: 0 }));
});


test('Base32 rejeita preenchimento fora de posição e padrões fracos', () => {
  assert.throws(() => normalizeSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ====AAAA'), /inválida|Base32/);
  assert.throws(() => normalizeSecret('AAAAAAAAAAAAAAAA'), /pouca variedade|padrão repetido/);
  assert.throws(() => normalizeSecret('JBSWY3DPEHPK3PXP!'), /Base32/);
  assert.equal(normalizeSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});
