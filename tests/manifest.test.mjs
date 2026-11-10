import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Manifest MV3 mantém permissões mínimas', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'clipboardWrite']);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.host_permissions, undefined);
});

test('Ícones locais declarados no Manifest existem', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  for (const path of Object.values(manifest.icons || {})) {
    const { access } = await import('node:fs/promises');
    await access(new URL(`../${path}`, import.meta.url));
  }
  for (const path of Object.values(manifest.action.default_icon || {})) {
    const { access } = await import('node:fs/promises');
    await access(new URL(`../${path}`, import.meta.url));
  }
});
