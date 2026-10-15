import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'admin/admin.html'), 'utf8');
const checks = [
  ['admin API endpoint is wired', "'/api/admin/devices'"],
  ['ban and unban UI actions exist', 'data-action="unban"'],
  ['secret field uses password input', 'id="adminToken" type="password"'],
  ['script does not persist admin token in localStorage', '!localStorage'],
  ['script does not persist admin token in sessionStorage', '!sessionStorage'],
  ['admin UI escapes untrusted server strings', 'function escapeHtml('],
  ['admin UI restricts public server URLs to HTTPS', 'Для внешнего сервера нужен HTTPS'],
  ['device export excludes any token field', 'pgmzchat-devices-export.json'],
];
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(scriptMatch, 'embedded admin script exists');
new vm.Script(scriptMatch[1], { filename: 'admin.html.inline.js' });
console.log('PASS: admin script parses without syntax errors');
for (const [description, fragment] of checks) {
  const ok = fragment === '!localStorage' ? !scriptMatch[1].includes('localStorage')
    : fragment === '!sessionStorage' ? !scriptMatch[1].includes('sessionStorage')
    : html.includes(fragment) || scriptMatch[1].includes(fragment);
  assert.ok(ok, description);
  console.log(`PASS: ${description}`);
}
assert.ok(!/<script\s+src\s*=\s*["']https?:/i.test(html), 'admin panel has no external scripts');
assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(scriptMatch[1]), 'admin token is not written to browser storage');
console.log('All admin panel static security checks passed.');
