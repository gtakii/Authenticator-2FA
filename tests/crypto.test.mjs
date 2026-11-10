import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncryptedVault, decryptVault, encryptWithPassword, decryptWithPassword } from '../scripts/crypto.js';

test('cofre AES-256-GCM: criação e descriptografia', async () => {
  const accounts = [{ id:'1', issuer:'GitHub', account:'user@example.com', secret:'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }];
  const { payload } = await createEncryptedVault('frase-senha-segura-para-teste', accounts);
  const opened = await decryptVault('frase-senha-segura-para-teste', payload);
  assert.deepEqual(opened.accounts, accounts);
  await assert.rejects(() => decryptVault('senha-incorreta-para-teste', payload));
});

test('backup criptografado: restauração e detecção de adulteração', async () => {
  const data = { accounts: [{ issuer:'GitHub', secret:'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }] };
  const backup = await encryptWithPassword('senha-exclusiva-do-backup', data);
  assert.deepEqual(await decryptWithPassword('senha-exclusiva-do-backup', backup), data);
  const tampered = { ...backup, ciphertext: backup.ciphertext.slice(0, -4) + 'AAAA' };
  await assert.rejects(() => decryptWithPassword('senha-exclusiva-do-backup', tampered));
});
