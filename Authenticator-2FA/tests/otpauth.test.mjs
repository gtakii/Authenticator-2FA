import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOtpAuthUri, parseManualOtpAuthConfig, buildOtpAuthUri } from '../scripts/otpauth.js';

const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('URI otpauth válida preserva os parâmetros TOTP', () => {
  const uri = `otpauth://totp/Example%3Auser%40mail.test?secret=${secret}&issuer=Example&algorithm=SHA256&digits=8&period=45`;
  const parsed = parseOtpAuthUri(uri);
  assert.equal(parsed.issuer, 'Example');
  assert.equal(parsed.account, 'user@mail.test');
  assert.deepEqual(parsed.options, { algorithm: 'SHA256', digits: 8, period: 45 });
});

test('URI rejeita parâmetros duplicados, desconhecidos e conflitantes', () => {
  assert.throws(() => parseOtpAuthUri(`otpauth://totp/X?secret=${secret}&secret=${secret}`), /duplicado/);
  assert.throws(() => parseOtpAuthUri(`otpauth://totp/X?secret=${secret}&counter=2`), /não suportados/);
  assert.throws(() => parseOtpAuthUri(`otpauth://totp/Other%3Auser?secret=${secret}&issuer=Example`), /não corresponde/);
  assert.throws(() => parseOtpAuthUri(`otpauth://hotp/X?secret=${secret}`), /não suportado/);
});

test('URI gerada pode ser importada sem perder os parâmetros', () => {
  const uri = buildOtpAuthUri({ issuer: 'Service', account: 'user@example.test', secret, algorithm: 'SHA512', digits: 7, period: 60 });
  const parsed = parseOtpAuthUri(uri);
  assert.deepEqual(parsed.options, { algorithm: 'SHA512', digits: 7, period: 60 });
  assert.equal(parsed.secret, secret);
});


test('formulários oferecem URI e configuração manual explícita, sem aceitar segredo solto fora do bloco', async () => {
  const fs = await import('node:fs/promises');
  for (const file of ['../popup/index.html', '../popup/dashboard.html']) {
    const html = await fs.readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(html, /id="manual-secret"/);
    assert.match(html, /id="otpauth-uri"/);
    assert.match(html, /QR Code de configuração/);
  }
});

test('URI recusa links HTTP, texto aleatório e codificação percentual quebrada', () => {
  assert.throws(() => parseOtpAuthUri('https://myaccount.google.com/two-step-verification/authenticator'), /otpauth/);
  assert.throws(() => parseOtpAuthUri('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'), /otpauth/);
  assert.throws(() => parseOtpAuthUri(`otpauth://totp/Service%ZZ:user?secret=${secret}`), /otpauth/);
});

test('URI completa pode ser importada sem preencher o serviço manualmente', () => {
  const parsed = parseOtpAuthUri(`otpauth://totp/Example%3Auser%40mail.test?secret=${secret}&issuer=Example`);
  assert.equal(parsed.issuer, 'Example');
  assert.equal(parsed.account, 'user@mail.test');
});


test('configuração manual valida chave, emissor e parâmetros TOTP', () => {
  const parsed = parseManualOtpAuthConfig({ issuer: 'Example', account: 'user@example.test', secret, algorithm: 'SHA256', digits: '8', period: '60' });
  assert.equal(parsed.issuer, 'Example');
  assert.equal(parsed.secret, secret);
  assert.deepEqual(parsed.options, { algorithm: 'SHA256', digits: 8, period: 60 });
});

test('configuração manual rejeita senha, chave malformada e parâmetros inválidos', () => {
  assert.throws(() => parseManualOtpAuthConfig({ issuer: 'Example', secret: 'minha-senha' }), /Chave inválida|curta demais/);
  assert.throws(() => parseManualOtpAuthConfig({ issuer: '', secret }), /nome do serviço/);
  assert.throws(() => parseManualOtpAuthConfig({ issuer: 'Example', secret, algorithm: 'MD5' }), /Algoritmo/);
  assert.throws(() => parseManualOtpAuthConfig({ issuer: 'Example', secret, digits: 5 }), /dígitos/);
});
