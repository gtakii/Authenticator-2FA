import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
test('documentos HTML usam apenas recursos locais e existentes', () => {
  for (const file of ['popup/index.html', 'popup/dashboard.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const ref of refs) {
      if (/^(?:#|data:|mailto:|javascript:)/i.test(ref)) continue;
      assert.doesNotMatch(ref, /^https?:\/\//i, `${file} não deve carregar recursos remotos: ${ref}`);
      const target = path.resolve(path.dirname(path.join(root, file)), ref.split(/[?#]/)[0]);
      assert.ok(target.startsWith(root + path.sep), `${file} referencia caminho fora do projeto: ${ref}`);
      assert.ok(fs.existsSync(target), `${file} referencia arquivo inexistente: ${ref}`);
    }
  }
});
test('Manifest V3 não declara host permissions nem scripts remotos', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['clipboardWrite', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.content_scripts, undefined);
});
test('arquivos essenciais de publicação existem', () => {
  for (const file of ['README.md', 'CHANGELOG.md', 'PRIVACY.md', 'CONTRIBUTING.md', 'PUBLICACAO.md', 'SECURITY_REVIEW.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(fs.existsSync(path.join(root, file)), `Arquivo ausente: ${file}`);
  }
});
